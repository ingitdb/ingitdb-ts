export interface IngitDbSchema {
  collections: IngitDbCollection[];
}

export interface IngitDbCollection {
  id: string;
  path: string;
  views?: View[];
  title?: string;
  description?: string;
}

export interface View {
  id: string;
  columns: Col[];
}

export interface Col {
  id: string;
  title?: string;
  type: 'string' | 'number';
}

