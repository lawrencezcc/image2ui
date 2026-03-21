import { createRouter, createWebHistory } from 'vue-router'

import PreviewPage from './pages/PreviewPage.vue'
import RenderStagePage from './pages/RenderStagePage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'preview',
      component: PreviewPage,
    },
    {
      path: '/render',
      name: 'render-stage',
      component: RenderStagePage,
    },
  ],
})
