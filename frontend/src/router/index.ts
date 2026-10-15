import { createRouter, createWebHistory } from 'vue-router'

import { installRouterGuards } from './guard'
import { routes } from './routes'

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

installRouterGuards(router)

export { routes }
