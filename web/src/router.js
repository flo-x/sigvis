import { createRouter, createWebHashHistory } from "vue-router";
import SettingsView from "./components/SettingsView.vue";
import AboutView from "./components/AboutView.vue";
import ServerSettingsView from "./components/ServerSettingsView.vue";
import GeneratorsView from "./components/GeneratorsView.vue";
import DataSeriesView from "./components/DataSeriesView.vue";

const routes = [
  { path: "/",                   redirect: "/dashboard" },
  { path: "/dashboard",          name: "dashboard" },
  { path: "/dashboard/:id",      name: "dashboard-tab" },
  { path: "/settings",           name: "settings",        component: SettingsView },
  { path: "/server-settings",    name: "server-settings", component: ServerSettingsView },
  { path: "/generators",         name: "generators",      component: GeneratorsView },
  { path: "/data-series",        name: "data-series",     component: DataSeriesView },
  { path: "/about",              name: "about",           component: AboutView },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
