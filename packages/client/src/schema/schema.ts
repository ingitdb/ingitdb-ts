import { parseYaml } from '../utils/yaml'

export interface ColumnDef {
  name?: string
  type?: string
  required?: boolean
  [key: string]: unknown
}

export interface CollectionSchema {
  columns: ColumnDef[]
  columns_order: string[]
  columnsMap: Record<string, ColumnDef>
  record_file?: { name?: string }
  default_view?: Record<string, unknown> | null
  path?: string
  [key: string]: unknown
}

export const parseCollectionSchema = (source: string | Record<string, unknown>): CollectionSchema => {
  const raw = typeof source === 'string' ? (parseYaml(source) as Record<string, unknown>) : source
  return normalizeCollectionSchema(raw || {})
}

export const normalizeCollectionSchema = (schema: Record<string, unknown>): CollectionSchema => {
  let columns: ColumnDef[] = []
  if (Array.isArray(schema['columns'])) {
    columns = schema['columns'] as ColumnDef[]
  } else if (typeof schema['columns'] === 'object' && schema['columns'] !== null) {
    columns = Object.entries(schema['columns'] as Record<string, unknown>).map(([name, def]) => ({
      name,
      ...(typeof def === 'object' ? (def as Record<string, unknown>) : {})
    }))
  }
  const columnsOrder =
    Array.isArray(schema['columns_order']) && (schema['columns_order'] as unknown[]).length > 0
      ? (schema['columns_order'] as string[])
      : columns.map((c) => c.name).filter((n): n is string => Boolean(n))
  return {
    ...schema,
    columns,
    columns_order: columnsOrder,
    columnsMap: Object.fromEntries(
      columns.filter((c) => c.name).map((c) => [c.name, c])
    )
  }
}
