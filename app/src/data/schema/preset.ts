import { z } from 'zod';

export const Preset = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().min(1),
  name: z.string().min(1),
  family: z.string(),
  params: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Preset = z.infer<typeof Preset>;
