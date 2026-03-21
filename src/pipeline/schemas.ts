export const sceneResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'scene_json'],
  properties: {
    summary: { type: 'string' },
    scene_json: { type: 'string' },
  },
}

export const componentResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['component', 'summary', 'assumptions'],
  properties: {
    component: { type: 'string' },
    summary: { type: 'string' },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
}
