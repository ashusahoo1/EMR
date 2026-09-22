/**
 * TypeBox -> OpenAI strict structured output (BUILD_ROADMAP B3 step 2).
 *
 * The roadmap says "TypeBox IS JSON Schema, so this should be a direct
 * handoff". It very nearly is -- but not quite, and the gap is worth
 * recording because the failure mode is a 400 at runtime rather than a type
 * error at build time.
 *
 * Strict mode uses CONSTRAINED DECODING: it restricts the tokens the model
 * may emit so the output cannot leave the grammar. That buys a guarantee of
 * shape, but it means every schema keyword must be expressible as a grammar
 * rule. Value-level assertions -- "this string is at most 500 chars", "this
 * array has at most 50 items" -- are not, because you cannot know you have
 * violated them until after you have emitted the tokens. OpenAI's answer is
 * to reject those keywords outright rather than silently ignore them.
 *
 * Our schema (A2) carries exactly those keywords, because the SAME schema
 * also validates the HTTP boundary, where they are real enforcement. So the
 * two consumers want two different documents from one source of truth:
 *
 *   Elysia / server-side validation -> the full schema, limits enforced
 *   OpenAI strict decoding          -> the same shape, limits stripped
 *
 * Stripping is the right direction. A limit dropped here is not a limit lost:
 * `parseStructuredNote` (B6) validates the model's output against the FULL
 * schema afterwards. The provider guarantees shape; we still check truth
 * (§4.5: "Provider enforcement guarantees shape, not truth").
 *
 * WHAT THE ROADMAP EXPECTED, AND WHAT WAS ACTUALLY TRUE
 * Step 2 predicted `t.Union` would be the thing strict mode rejects, and said
 * to flatten it. It does not: nested `anyOf` is explicitly supported, and
 * OpenAI's own docs use `anyOf: [{$ref}, {type: null}]` for precisely our
 * nullable shape. `chiefComplaint` passes through intact. The real rejections
 * are the length/size keywords, which the roadmap did not anticipate. No
 * flattening workaround is needed; the note stays here instead.
 */

/**
 * Keywords strict mode rejects, by the type they attach to.
 *
 * Verified against OpenAI's published subset. Listed in full rather than
 * filtered by an allowlist so that a future TypeBox version emitting some
 * keyword we have never seen fails loudly at the API rather than being
 * quietly dropped here.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  // String
  'minLength',
  'maxLength',
  'pattern',
  'format',
  // Number
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  // Object
  'patternProperties',
  'unevaluatedProperties',
  'propertyNames',
  'minProperties',
  'maxProperties',
  // Array
  'unevaluatedItems',
  'contains',
  'minContains',
  'maxContains',
  'minItems',
  'maxItems',
  'uniqueItems',
  // Not expressible as a decoding grammar, and silently changes meaning.
  'default',
])

/**
 * TypeBox's own bookkeeping symbols and hints.
 *
 * These are not JSON Schema and mean nothing to the provider. They travel as
 * string keys on the object (`[Kind]` is a symbol, but `$id` is not), so they
 * are dropped explicitly.
 */
const TYPEBOX_KEYWORDS = new Set(['$id', 'kind'])

/** Depth limit strict mode enforces. Ours is 3; the cap is 5. */
const MAX_NESTING_DEPTH = 5

/** Property-count limit strict mode enforces. */
const MAX_TOTAL_PROPERTIES = 100

type JsonSchema = Record<string, unknown>

/**
 * Rewrite a TypeBox schema into the strict-mode subset.
 *
 * Recursive, because the keywords we must strip live on the LEAF nodes --
 * `SourcedItem.text.maxLength` is three levels down, inside an array, inside
 * a property. A shallow copy would leave every one of them in place and the
 * call would 400.
 *
 * Also enforces strict mode's two structural requirements on every object it
 * passes: `additionalProperties: false`, and every declared property listed
 * in `required`. Our schema already satisfies both (A2 set them deliberately),
 * but asserting it here means a future field added without them is caught by
 * `toStrictSchema`'s own tests rather than by a support ticket.
 */
export function toStrictSchema(schema: unknown): JsonSchema {
  const converted = convert(schema, 0)
  assertWithinLimits(converted)
  return converted
}

function convert(node: unknown, depth: number): JsonSchema {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`Schema nests deeper than strict mode's ${MAX_NESTING_DEPTH} levels.`)
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('Expected a JSON Schema object.')
  }

  const source = node as JsonSchema
  const out: JsonSchema = {}

  for (const [key, value] of Object.entries(source)) {
    if (UNSUPPORTED_KEYWORDS.has(key) || TYPEBOX_KEYWORDS.has(key)) continue

    if (key === 'properties') {
      const properties: JsonSchema = {}
      for (const [name, child] of Object.entries(value as JsonSchema)) {
        // A property is a nesting level; its own contents are deeper still.
        properties[name] = convert(child, depth + 1)
      }
      out.properties = properties
      continue
    }

    if (key === 'items') {
      out.items = convert(value, depth + 1)
      continue
    }

    // anyOf survives -- it is how strict mode expresses nullability, and it
    // is what carries `chiefComplaint`. Each branch is converted in turn.
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      const branches = (value as unknown[]).map((branch) => convert(branch, depth))
      // oneOf/allOf are not in the supported subset; anyOf is. Ours only ever
      // produces anyOf, but normalising means a future t.Intersect does not
      // ship a keyword the provider silently mishandles.
      out.anyOf = branches
      continue
    }

    out[key] = value
  }

  if (out.type === 'object') {
    // Required by strict mode, and already true of our schema -- but assert
    // rather than assume, so a new field cannot regress it silently.
    out.additionalProperties = false

    const declared = Object.keys((out.properties ?? {}) as JsonSchema)
    const required = new Set((out.required as string[] | undefined) ?? [])
    const missing = declared.filter((name) => !required.has(name))
    if (missing.length > 0) {
      throw new Error(
        `Strict mode requires every property in \`required\`; missing: ${missing.join(', ')}. ` +
          'Use a union with null to express an optional field.',
      )
    }
    out.required = declared
  }

  return out
}

/** Strict mode caps total properties at 100; ours is far below. */
function assertWithinLimits(schema: JsonSchema): void {
  const total = countProperties(schema)
  if (total > MAX_TOTAL_PROPERTIES) {
    throw new Error(
      `Schema declares ${total} properties; strict mode allows ${MAX_TOTAL_PROPERTIES}.`,
    )
  }
}

function countProperties(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0
  if (Array.isArray(node)) {
    return node.reduce<number>((sum, child) => sum + countProperties(child), 0)
  }

  const schema = node as JsonSchema
  let count = 0
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties') {
      const properties = value as JsonSchema
      count += Object.keys(properties).length
      for (const child of Object.values(properties)) count += countProperties(child)
      continue
    }
    count += countProperties(value)
  }
  return count
}
