import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';

/** Indexer health — the _meta introspection every ops dashboard starts with. */
export const indexerMeta = defineQuery({
  id: 'the-graph.health.indexerMeta',
  operationName: 'IndexerHealth',
  sdl: `
    query IndexerHealth {
      _meta {
        deployment
        hasIndexingErrors
        block {
          number
          hash
          timestamp
        }
      }
    }
  `,
  variables: z.object({}).strict(),
  response: z.object({
    _meta: z
      .object({
        deployment: z.string().optional(),
        hasIndexingErrors: z.boolean().optional(),
        block: z
          .object({
            number: z.number().optional(),
            hash: z.string().optional(),
            timestamp: z.number().optional(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
  }),
});
