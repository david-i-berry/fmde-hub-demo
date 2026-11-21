import 'vuetify/styles'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import App from './App.vue'
import { icons } from './icons'
import { getDb } from './db/client'
import { autoConnect, loadFeatures } from './runtime-config'
import { router } from './router'

const vuetify = createVuetify({
  icons,
  theme: {
    defaultTheme: 'system',
    themes: {
      light: { colors: { primary: '#1c5cab', background: '#f9f9f7', surface: '#fcfcfb' } },
      dark: { colors: { primary: '#86b6ef', background: '#0d0d0d', surface: '#1a1a19' } },
    },
  },
  defaults: { VCard: { rounded: 'lg' } },
})

// FMDEhub needs a secure context (https, or http://localhost): Web Crypto (message hashing), Web Locks
// (one tab leads), the service worker and persistent storage are unavailable elsewhere. Say so plainly
// instead of starting a half-working app.
if (!window.isSecureContext) {
  const msg = document.createElement('p')
  msg.style.cssText = 'font: 16px/1.5 system-ui, sans-serif; max-width: 40em; margin: 3em auto; padding: 0 1em'
  msg.textContent = 'FMDEhub must be opened over https (or on localhost). This page was loaded over plain http, where the browser withholds features FMDEhub needs.'
  document.getElementById('app')!.replaceChildren(msg)
} else {
  // Start the worker early: tabs elect a leader, which opens PGlite and resumes ingest.
  void getDb()
  // deployments (config.json): connect to the configured broker on first load
  void autoConnect()

  // deployment switches first, so a public view never flashes the conformance UI
  void loadFeatures().finally(() => createApp(App).use(router).use(vuetify).mount('#app'))
}
