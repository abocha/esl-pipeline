export interface AnytypeSpace {
  id: string;
  name: string;
}

export type AnytypeIconFormat = 'emoji' | 'image';

export interface AnytypeIcon {
  emoji?: string;
  format?: AnytypeIconFormat;
}

export interface AnytypeProperty {
  key: string;
  text?: string;
  select?: string;
  number?: number;
  checkbox?: boolean;
  date?: string;
}

export interface AnytypeObject {
  id: string;
  name?: string;
  type_key?: string;
  icon?: AnytypeIcon;
  body?: string;
  properties?: AnytypeProperty[];
  created_at?: string;
  updated_at?: string;
}

export interface AnytypeCreateObjectPayload {
  name: string;
  type_key?: string;
  icon?: AnytypeIcon;
  body?: string;
  properties?: AnytypeProperty[];
}

export interface AnytypeUpdateObjectPayload {
  name?: string;
  body?: string;
  icon?: AnytypeIcon;
  properties?: AnytypeProperty[];
}

export interface AnytypeSearchPayload {
  query: string;
  limit?: number;
  types?: string[];
  sort?: {
    field: string;
    direction?: 'asc' | 'desc';
  };
}
