/**
 * TypeBox -> OpenAI strict schema conversion (BUILD_ROADMAP B3 step 2).
 *
 * Unlike the prompt, this IS deterministic logic with a right answer, so it
 * is tested properly rather than by inspection. The failure it prevents is a
 * 400 from the provider at runtime -- invisible until a real call is made,
 * which is exactly the kind of thing that should not wait for B8.
 */
import { describe, expect, test } from 'bun:test'
import { StructuredNote } from '@emr/shared'
import { Type as t } from '@sinclair/typebox'
import { toStrictSchema } from './strict-schema.ts'

/**
 * A loosely-typed view of the converted schema.
 *
 * The converter's return type is deliberately a plain JSON object -- it
 * produces a document for the wire, not a typed structure -- so the tests
 * reach into it by name. `unknown` at every step would make each assertion
 * three lines of narrowing and obscure what is being checked.
 */
interface Node {
  type?: string
  description?: string
  anyOf?: Node[]
  items?: Node
  properties?: Record<string, Node>
  required?: string[]
  additionalProperties?: boolean
}

const strict = toStrictSchema(StructuredNote) as unknown as Node

/** A named property of a schema object, failing clearly if it is absent. */
function prop(node: Node, name: string): Node {
  const found = node.properties?.[name]
  if (found === undefined) throw new Error(`missing schema property: ${name}`)
  return found
}

/** The `items` schema of an array node, failing clearly if it is absent. */
function items(node: Node): Node {
  if (node.items === undefined) throw new Error('expected an array schema with items')
  return node.items
}

/** Walk every node of a schema, so assertions can cover the whole tree. */
function everyNode(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) everyNode(child, visit)
    return
  }
  visit(node as Record<string, unknown>)
  for (const value of Object.values(node as Record<string, unknown>)) {
    everyNode(value, visit)
  }
}

describe('the keywords strict mode rejects are gone', () => {
  test('no length, size or pattern keyword survives anywhere in the tree', () => {
    // These are the actual cause of a strict-mode 400. Our schema carries
    // maxLength on every SourcedItem field and maxItems on every array, so
    // this is not a hypothetical.
    const banned = [
      'minLength',
      'maxLength',
      'pattern',
      'format',
      'minimum',
      'maximum',
      'multipleOf',
      'minItems',
      'maxItems',
      'uniqueItems',
      'minProperties',
      'maxProperties',
      'patternProperties',
      'propertyNames',
      'default',
    ]
    const found: string[] = []
    everyNode(strict, (node) => {
      for (const key of banned) if (key in node) found.push(key)
    })
    expect(found).toEqual([])
  })

  test('the source schema really does contain them -- the test is not vacuous', () => {
    // If A2 ever drops its limits, the assertion above would pass for the
    // wrong reason. This pins the premise.
    const source: string[] = []
    everyNode(StructuredNote, (node) => {
      if ('maxLength' in node) source.push('maxLength')
      if ('maxItems' in node) source.push('maxItems')
    })
    expect(source.length).toBeGreaterThan(0)
  })
})

describe('the shape the model must produce is unchanged', () => {
  test('all six fields survive conversion', () => {
    expect(Object.keys(strict.properties ?? {}).sort()).toEqual([
      'chiefComplaint',
      'doctorPlan',
      'medicationsMentioned',
      'missingInformation',
      'relevantHistory',
      'symptoms',
    ])
  })

  test('chiefComplaint stays nullable via anyOf', () => {
    // The roadmap predicted t.Union would need flattening. It does not:
    // nested anyOf is in the supported subset, and it is how OpenAI's own
    // docs express nullability. Verified against the published schema rules.
    const branches = prop(strict, 'chiefComplaint').anyOf
    expect(branches).toHaveLength(2)
    expect(branches?.some((b) => b.type === 'null')).toBe(true)
    expect(branches?.some((b) => b.type === 'object')).toBe(true)
  })

  test('SourcedItem keeps text and sourceSpan, nested inside arrays', () => {
    const item = items(prop(strict, 'symptoms'))
    expect(item.type).toBe('object')
    expect(Object.keys(item.properties ?? {}).sort()).toEqual(['sourceSpan', 'text'])
    expect(prop(item, 'text').type).toBe('string')
  })

  test('missingInformation stays an array of plain strings', () => {
    // No sourceSpan by design -- it describes what is NOT in the notes, so
    // there is nothing to ground it against (§4.5).
    const item = items(prop(strict, 'missingInformation'))
    expect(item.type).toBe('string')
    expect(item.properties).toBeUndefined()
  })

  test('descriptions are preserved -- they carry instruction to the model', () => {
    // `description` IS in the supported subset, and the sourceSpan one tells
    // the model to copy verbatim. Stripping it would quietly weaken rule 2.
    const span = prop(items(prop(strict, 'symptoms')), 'sourceSpan')
    expect(span.description).toContain('verbatim')
  })
})

describe("strict mode's structural requirements hold everywhere", () => {
  test('every object sets additionalProperties: false', () => {
    // E12: the model cannot invent a `bloodPressure` key that does not
    // exist. This is the schema-level guardrail §4.5 calls cheaper than
    // prompting.
    const offenders: unknown[] = []
    everyNode(strict, (node) => {
      if (node.type === 'object' && node.additionalProperties !== false) {
        offenders.push(node)
      }
    })
    expect(offenders).toEqual([])
  })

  test('every declared property is listed in required', () => {
    const offenders: string[] = []
    everyNode(strict, (node) => {
      if (node.type !== 'object') return
      const declared = Object.keys((node.properties ?? {}) as object)
      const required = (node.required ?? []) as string[]
      for (const name of declared) if (!required.includes(name)) offenders.push(name)
    })
    expect(offenders).toEqual([])
  })

  test('the root is an object, not an anyOf', () => {
    // Explicitly disallowed: "Root objects can't be the anyOf type."
    expect(strict.type).toBe('object')
    expect(strict.anyOf).toBeUndefined()
  })
})

describe('the converter refuses schemas strict mode would reject', () => {
  test('an optional property is rejected with a message naming the fix', () => {
    // t.Optional produces a property absent from `required`, which strict
    // mode forbids. Failing here, loudly, beats a 400 at the first real call.
    const withOptional = t.Object({
      a: t.String(),
      b: t.Optional(t.String()),
    })
    expect(() => toStrictSchema(withOptional)).toThrow(/union with null/)
  })

  test('it names which property is at fault', () => {
    const withOptional = t.Object({ keeper: t.String(), stray: t.Optional(t.Number()) })
    expect(() => toStrictSchema(withOptional)).toThrow(/stray/)
  })

  test('non-object input is rejected rather than silently passed through', () => {
    expect(() => toStrictSchema(null)).toThrow()
    expect(() => toStrictSchema('not a schema')).toThrow()
  })
})

describe('the result is a valid JSON document', () => {
  test('it survives a JSON round trip unchanged', () => {
    // It goes over the wire as JSON. A stray symbol or undefined would be
    // dropped silently in transit rather than throwing here.
    expect(JSON.parse(JSON.stringify(strict))).toEqual(strict)
  })

  test('nesting stays within the five-level cap', () => {
    function depth(node: unknown): number {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return 0
      const schema = node as Record<string, unknown>
      let deepest = 0
      if (schema.properties) {
        for (const child of Object.values(schema.properties as object)) {
          deepest = Math.max(deepest, 1 + depth(child))
        }
      }
      if (schema.items) deepest = Math.max(deepest, 1 + depth(schema.items))
      if (Array.isArray(schema.anyOf)) {
        for (const branch of schema.anyOf) deepest = Math.max(deepest, depth(branch))
      }
      return deepest
    }
    expect(depth(strict)).toBeLessThanOrEqual(5)
  })
})
