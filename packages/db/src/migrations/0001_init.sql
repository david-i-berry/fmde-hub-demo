-- FMDEhub schema. Plain PostgreSQL: portable from PGlite to a native server.

create table fmdehub_setting (
  key   text primary key,
  value jsonb not null
);

insert into fmdehub_setting (key, value) values
  ('lateAfterSeconds', '1200'),        -- node LATE when last seen longer ago than this (no data for 20 min)
  ('silentAfterSeconds', '1800'),      -- node SILENT when last seen longer ago than this (30 min)
  ('retentionDays', '7'),              -- observations, message log and issues
  ('futureToleranceSeconds', '60');    -- clock tolerance for TIME_IN_FUTURE

-- Current record per node. Created on the first message of any kind for the topic.
create table node (
  node_key             text primary key,
  group_id             text not null,
  node_id              text not null,
  topic                text not null,
  declared_id          text,
  name                 text,
  serial_number        text,
  firmware_version     text,
  url                  text,
  location             jsonb,
  metadata_version     integer,          -- null until metadata is received
  metadata_hash        text,
  metadata_received_at timestamptz,       -- when the current version was first received
  metadata_seen_at     timestamptz,       -- last receipt, including identical republishes
  metadata_cleared_at  timestamptz,       -- zero-length retained message received
  first_seen_at        timestamptz not null,
  hub_config           jsonb not null default '{}'
);

-- One row per distinct metadata content (identical republishes do not create versions).
create table metadata_version (
  node_key     text not null references node (node_key) on delete cascade,
  version      integer not null,
  received_at  timestamptz not null,
  content_hash text not null,
  message      jsonb not null,             -- full decoded Metadata
  normalised   jsonb not null,             -- MetadataVersion (packages/fmde)
  raw_bytes    integer not null,
  raw          bytea not null,
  primary key (node_key, version)
);

create table observer_device (
  node_key         text not null,
  metadata_version integer not null,
  id               bigint not null,
  name             text not null,
  serial_number    text,
  firmware_version text,
  url              text,
  location         jsonb,
  primary key (node_key, metadata_version, id),
  foreign key (node_key, metadata_version) references metadata_version (node_key, version) on delete cascade
);

create table parameter (
  node_key               text not null,
  metadata_version       integer not null,
  definition_id          bigint not null,
  value_index            integer not null,
  param_key              text not null,
  series_key             text not null,
  definition_description text not null,
  long_name              text not null,
  unit                   text not null,
  standard_names         jsonb not null,
  device_kind            text not null,     -- node | observer | unspecified
  observer_id            bigint,
  cell_method            text not null,
  cell_period_seconds    bigint not null,
  primary key (node_key, metadata_version, definition_id, value_index),
  foreign key (node_key, metadata_version) references metadata_version (node_key, version) on delete cascade
);
create index parameter_series on parameter (series_key);

-- Message log: one row per data message. id = hash of topic + payload, so QoS 1 redeliveries
-- and replays of the same message are recognised and skipped.
create table data_message (
  id               text primary key,
  node_key         text not null references node (node_key) on delete cascade,
  topic            text not null,
  received_at      timestamptz not null,
  first_obs_time   timestamptz,
  last_obs_time    timestamptz,
  observations     integer not null,
  values_count     integer not null,
  empty_values     integer not null,
  latency_seconds  double precision,       -- received_at - last_obs_time
  span_seconds     double precision,       -- received_at - first_obs_time (backlog depth)
  payload_bytes    integer not null,
  raw              bytea not null,
  metadata_version integer,
  conformance      jsonb not null default '[]'
);
create index data_message_node_received on data_message (node_key, received_at);
create index data_message_received on data_message (received_at);

-- Observations keyed by series (stable across metadata versions) and time: a value
-- delivered twice (redelivery, store-and-forward resend) is stored once.
create table observation (
  series_key       text not null,
  obs_time         timestamptz not null,
  node_key         text not null,
  param_key        text not null,
  metadata_version integer not null,
  definition_id    bigint not null,
  value_kind       text not null,
  value_num        double precision,
  value_text       text,                   -- strings, and exact text of 64-bit integers
  value_bool       boolean,
  is_empty         boolean not null,
  message_id       text not null,
  received_at      timestamptz not null,
  primary key (series_key, obs_time)
);
create index observation_node_time on observation (node_key, obs_time);
create index observation_param_time on observation (param_key, obs_time);
create index observation_empty_received on observation (received_at) where is_empty; -- empty values in a window

-- Every conformance issue, for any message kind (including undecodable ones).
create table conformance_issue (
  id          bigserial primary key,
  received_at timestamptz not null,
  topic       text not null,
  node_key    text,
  message_id  text,
  kind        text not null,               -- metadata | data | unknown
  code        text not null,
  severity    text not null default 'error', -- error | warning (CODE_INFO in packages/fmde/src/ats.ts)
  test        text,                         -- FMDE ATS test label, e.g. /conf/message-encoding/node
  detail      text not null
);
create index conformance_issue_received on conformance_issue (received_at);
create index conformance_issue_node on conformance_issue (node_key, received_at);

-- When the hub was actually listening. Time outside these intervals is
-- "not monitored", never "missing".
create table monitored_interval (
  id      bigserial primary key,
  source  text not null,
  from_ts timestamptz not null,
  to_ts   timestamptz not null
);

-- Derived metrics as SQL, so every view and a future server compute the same numbers.

create function fmdehub_setting_num(p_key text) returns double precision
language sql stable as $$
  select (value #>> '{}')::double precision from fmdehub_setting where key = p_key
$$;

-- Retention: observations, the message log, issues and monitored intervals older than retentionDays
-- (at least 1 day, so 0 or a missing value never empties the database). Metadata is kept, and so are
-- the issues of each node's current metadata version: conformance counts them, and an identical
-- republish does not record them again.
create function fmdehub_retention_cutoff(p_now timestamptz) returns timestamptz
language sql stable as $$
  select p_now - make_interval(days => greatest(coalesce(fmdehub_setting_num('retentionDays'), 7), 1)::int)
$$;

create function fmdehub_prune(p_now timestamptz) returns void
language sql as $$
  delete from observation where received_at < fmdehub_retention_cutoff(p_now);
  delete from data_message where received_at < fmdehub_retention_cutoff(p_now);
  delete from conformance_issue c
   where c.received_at < fmdehub_retention_cutoff(p_now)
     and (c.kind <> 'metadata'
          or c.node_key is null
          or c.received_at < (select n.metadata_received_at from node n where n.node_key = c.node_key));
  delete from monitored_interval where to_ts < fmdehub_retention_cutoff(p_now);
$$;

-- Per-node status over the window [p_from, p_to), evaluated at p_now. State and conformance are separate:
--   state        "is it working?"  NO_METADATA, NEVER_SEEN, SILENT, LATE, DEGRADED, OK
--   conformance  "does it meet FMDE?"  CONFORMANT, WARNINGS, NON_CONFORMANT
-- DEGRADED means data was lost in the window: empty values (except parameters the hub configuration
-- lists in expectedEmpty, by long name or series key), or observations that could not be decoded or
-- stored. Conformance issues alone never degrade a node. Conformance counts the issues of the current
-- metadata version (whenever received) plus those of the window's messages. Expected reporting
-- frequency is deferred, so availability and timeliness are not computed; state uses last-seen
-- thresholds (global settings, overridable per node in hub_config). Scans are bounded by the window:
-- it re-runs after every ingest batch.
create function fmdehub_node_status(p_from timestamptz, p_to timestamptz, p_now timestamptz)
returns table (
  node_key                text,
  group_id                text,
  node_id                 text,
  name                    text,
  state                   text,
  conformance             text,
  metadata_version        integer,
  first_seen_at           timestamptz,
  last_seen_at            timestamptz,
  last_seen_age_seconds   double precision,
  messages                bigint,
  observations            bigint,
  empty_values            bigint,
  expected_empty_values   bigint,
  lost_data               bigint,
  conformance_errors      bigint,
  conformance_warnings    bigint,
  median_latency_seconds  double precision,
  max_span_seconds        double precision
)
language sql stable as $$
  with expected as (
    select n.node_key,
           coalesce(array(select jsonb_array_elements_text(n.hub_config -> 'expectedEmpty')), '{}'::text[]) as names
    from node n
  ),
  msg as (
    select m.node_key,
           count(*)                                                   as messages,
           coalesce(sum(m.observations), 0)                           as observations,
           percentile_cont(0.5) within group (order by m.latency_seconds) as median_latency,
           max(m.span_seconds)                                        as max_span
    from data_message m
    where m.received_at >= p_from and m.received_at < p_to
    group by m.node_key
  ),
  empties as (
    -- series_key = node|device|longName|cellMethod|period: part 3 is the long name
    select o.node_key,
           count(*) filter (where not (o.series_key = any(e.names) or split_part(o.series_key, '|', 3) = any(e.names))) as counted,
           count(*) filter (where o.series_key = any(e.names) or split_part(o.series_key, '|', 3) = any(e.names))     as expected
    from observation o
    join expected e on e.node_key = o.node_key
    where o.is_empty and o.received_at >= p_from and o.received_at < p_to
    group by o.node_key
  ),
  issues as (
    select c.node_key,
           -- observations that could not be decoded or stored: data lost
           count(*) filter (where c.in_window
                              and c.code in ('DECODE_ERROR', 'UNKNOWN_DEFINITION', 'VALUE_COUNT_MISMATCH', 'MISSING_TIME', 'NO_METADATA')) as lost,
           -- conformance: the current metadata version's issues, whenever received, plus the window's others
           count(*) filter (where c.counts and c.severity = 'error')  as errors,
           count(*) filter (where c.counts and c.severity <> 'error') as warnings
    from (
      select c.node_key, c.code, c.severity,
             (c.received_at >= p_from and c.received_at < p_to) as in_window,
             case when c.kind = 'metadata' then c.received_at >= n.metadata_received_at
                  else c.received_at >= p_from and c.received_at < p_to end as counts
      from conformance_issue c
      join node n on n.node_key = c.node_key
      where (c.received_at >= p_from and c.received_at < p_to)
         or (c.kind = 'metadata' and c.received_at >= n.metadata_received_at)
    ) c
    group by c.node_key
  ),
  base as (
    select n.*,
           ls.last_seen,
           extract(epoch from p_now - coalesce(ls.last_seen, n.metadata_received_at, n.first_seen_at)) as quiet_seconds,
           coalesce((n.hub_config ->> 'lateAfterSeconds')::double precision, fmdehub_setting_num('lateAfterSeconds'))     as late_after,
           coalesce((n.hub_config ->> 'silentAfterSeconds')::double precision, fmdehub_setting_num('silentAfterSeconds')) as silent_after,
           coalesce(msg.messages, 0)     as messages,
           coalesce(msg.observations, 0) as observations,
           coalesce(em.counted, 0)       as empty_values,
           coalesce(em.expected, 0)      as expected_empty_values,
           coalesce(i.lost, 0)           as lost_data,
           coalesce(i.errors, 0)         as conformance_errors,
           coalesce(i.warnings, 0)       as conformance_warnings,
           msg.median_latency,
           msg.max_span
    from node n
    -- backward scan of data_message_node_received, one row per node
    left join lateral (
      select max(m.received_at) as last_seen from data_message m where m.node_key = n.node_key and m.received_at <= p_now
    ) ls on true
    left join msg on msg.node_key = n.node_key
    left join empties em on em.node_key = n.node_key
    left join issues i on i.node_key = n.node_key
  )
  select b.node_key, b.group_id, b.node_id, b.name,
         case
           when b.metadata_version is null or b.metadata_cleared_at is not null then 'NO_METADATA'
           when b.last_seen is null then 'NEVER_SEEN'
           when b.quiet_seconds > b.silent_after then 'SILENT'
           when b.quiet_seconds > b.late_after then 'LATE'
           when b.empty_values > 0 or b.lost_data > 0 then 'DEGRADED'
           else 'OK'
         end,
         case
           when b.conformance_errors > 0 then 'NON_CONFORMANT'
           when b.conformance_warnings > 0 then 'WARNINGS'
           else 'CONFORMANT'
         end,
         b.metadata_version, b.first_seen_at, b.last_seen,
         extract(epoch from p_now - b.last_seen)::double precision,
         b.messages, b.observations::bigint, b.empty_values, b.expected_empty_values, b.lost_data,
         b.conformance_errors, b.conformance_warnings,
         b.median_latency, b.max_span
  from base b
  order by b.node_key
$$;
