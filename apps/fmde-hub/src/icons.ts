// Vuetify icons as inline SVG (no icon font). Vuetify's own built-in icons (checkbox, close, sort, …)
// use its mdi-svg aliases; icons named 'mdi-…' in FMDEhub's components resolve through ICON_PATHS.
import { h } from 'vue'
import type { IconOptions, IconProps, IconSet } from 'vuetify'
import { aliases, mdi as mdiSvg } from 'vuetify/iconsets/mdi-svg'
import { ICON_PATHS } from './icon-paths'

const mdi: IconSet = {
  component: (props: IconProps) =>
    h(mdiSvg.component, { ...props, icon: typeof props.icon === 'string' ? (ICON_PATHS[props.icon] ?? props.icon) : props.icon }),
}

export const icons: IconOptions = { defaultSet: 'mdi', aliases, sets: { mdi } }
