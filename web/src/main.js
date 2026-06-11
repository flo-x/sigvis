import { createApp } from 'vue'
import 'gridstack/dist/gridstack.min.css'
import 'uplot/dist/uPlot.min.css'
import './style.css'
import App from './App.vue'
import { router } from './router.js'

createApp(App).use(router).mount('#app')
