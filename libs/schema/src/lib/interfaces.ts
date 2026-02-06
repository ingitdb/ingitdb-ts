export interface DbSchema {
  collections: CollectionSchema[];
}

export interface CollectionSchema {
  id: string;
  path: string;
  fields: CollectionField[];
  readme?: Readme;
  views?: View[];
  title?: string;
  description?: string;
}

export interface CollectionField {
  id: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean
  title?: string;
}

export interface Readme {
  view: string;
  format: 'ul' | 'ol' | 'table';
  columns: string[];
}

export interface View {
  id: string;
  columns: ViewCol[];
}

export interface ViewCol {
  id: string;
  title?: string;
  type: 'string' | 'number';
}

