import { dump, load } from 'js-yaml'

export const parseYaml = (source: string): unknown => {
  if (!source) return null
  return load(source)
}

export const stringifyYaml = (value: unknown): string => dump(value, { noRefs: true, lineWidth: 120 })
