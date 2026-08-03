export interface IR {
  databaseName: string | null;
  domains: Domain[];          // ordered by first appearance in DBML
  tables: TableNode[];
  enums: EnumDef[];
  refs: Ref[];
}

export interface Domain { slug: string; name: string; tables: string[] }

export interface TableNode {
  name: string;
  domain: string;             // Domain.slug
  note: string | null;        // DBML Note
  columns: Column[];
  indexes: IndexDef[];
  purpose: string | null;     // overlay
  rules: string[];            // overlay
}

export interface Column {
  name: string;
  type: string;               // rendered type incl. args, e.g. varchar(50)
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  increment: boolean;
  default: string | null;
  note: string | null;        // DBML inline note
  enumName: string | null;    // set when type matches a DBML enum
  meaning: string | null;     // overlay
  generated: string | null;   // overlay
  formula: string | null;     // overlay
  valueSet: ValueSet | null;  // overlay: enum-like values for a varchar column (not a DBML enum)
}

// A varchar column whose allowed values live in a `note: 'A | B | C'` string, documented
// via the overlay `values:` field. open=true means the list is illustrative, not exhaustive.
export interface ValueSet {
  open: boolean;
  values: { value: string; meaning: string }[];
}

export interface EnumDef {
  name: string;
  values: { name: string; note: string | null; meaning: string | null }[];
}

export interface Ref {
  fromTable: string; fromColumns: string[];
  toTable: string; toColumns: string[];
  kind: 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';
}

export interface IndexDef {
  name: string | null;
  columns: string[];
  unique: boolean;
  note: string | null;
}
