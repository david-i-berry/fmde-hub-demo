-- Empty values by observation time, for counts per series in a window (the topology's empty-value
-- badges). observation_empty_received serves the same by receipt time, for the status function.
create index observation_empty_obs on observation (obs_time) where is_empty;
