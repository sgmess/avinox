/*
 * A small in-memory stand-in for the parts of the Firestore Admin SDK the
 * routes use, so they can be tested without an emulator. It follows the real
 * rules that matter here: update() fails on a missing document, set() with
 * merge merges maps key by key (so a key left out stays), and mergeFields
 * replaces just the named fields whole.
 */

type Data = Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);
const isMap = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);

function deepMerge(into: Data, from: Data) {
  for (const [k, v] of Object.entries(from)) {
    if (isMap(v) && isMap(into[k])) deepMerge(into[k] as Data, v);
    else into[k] = clone(v);
  }
}

export type SetOptions = { merge?: boolean; mergeFields?: string[] };

export class FakeFirestore {
  docs = new Map<string, Data>();
  /** Counts document reads, to check a page doesn't load more than it needs. */
  reads: string[] = [];

  collection(path: string) {
    return new Col(this, path);
  }
  batch() {
    const ops: (() => void)[] = [];
    const batch = {
      set: (ref: Doc, data: Data, opts?: SetOptions) => (ops.push(() => ref.write(data, opts)), batch),
      update: (ref: Doc, data: Data) => (ops.push(() => ref.patch(data)), batch),
      delete: (ref: Doc) => (ops.push(() => void this.docs.delete(ref.path)), batch),
      commit: async () => ops.forEach((op) => op()),
    };
    return batch;
  }
  async getAll(...refs: Doc[]) {
    return refs.map((r) => r.snap());
  }
  async recursiveDelete(col: Col) {
    for (const path of [...this.docs.keys()]) if (path.startsWith(`${col.path}/`)) this.docs.delete(path);
  }
  /** Ids of the documents directly in a collection. */
  ids(path: string) {
    return [...this.docs.keys()].filter((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/")).map((p) => p.slice(path.length + 1));
  }
}

class Snap {
  constructor(
    readonly ref: Doc,
    private readonly value: Data | undefined,
  ) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value === undefined ? undefined : clone(this.value);
  }
  get(field: string) {
    return this.value?.[field];
  }
}

class Doc {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string,
  ) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  collection(name: string) {
    return new Col(this.db, `${this.path}/${name}`);
  }
  snap() {
    this.db.reads.push(this.path);
    return new Snap(this, this.db.docs.get(this.path));
  }
  async get() {
    return this.snap();
  }
  write(data: Data, opts?: SetOptions) {
    const current = this.db.docs.get(this.path);
    if (opts?.mergeFields) {
      const next = clone(current ?? {});
      for (const f of opts.mergeFields) if (f in data) next[f] = clone(data[f]);
      this.db.docs.set(this.path, next);
    } else if (opts?.merge) {
      const next = clone(current ?? {});
      deepMerge(next, data);
      this.db.docs.set(this.path, next);
    } else this.db.docs.set(this.path, clone(data));
  }
  patch(data: Data) {
    const current = this.db.docs.get(this.path);
    if (!current) throw new Error(`NOT_FOUND: no document to update at ${this.path}`);
    if (!Object.keys(data).length) throw new Error("At least one field must be updated.");
    this.db.docs.set(this.path, { ...current, ...clone(data) });
  }
  async set(data: Data, opts?: SetOptions) {
    this.write(data, opts);
  }
  async update(data: Data) {
    this.patch(data);
  }
  async delete() {
    this.db.docs.delete(this.path);
  }
}

class Col {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string,
    private readonly order?: { field: string; desc: boolean },
    private readonly max?: number,
    private readonly after?: Snap,
  ) {}
  doc(id: string) {
    return new Doc(this.db, `${this.path}/${id}`);
  }
  async listDocuments() {
    return this.db.ids(this.path).map((id) => this.doc(id));
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc") {
    return new Col(this.db, this.path, { field, desc: dir === "desc" }, this.max, this.after);
  }
  limit(n: number) {
    return new Col(this.db, this.path, this.order, n, this.after);
  }
  startAfter(snap: Snap) {
    return new Col(this.db, this.path, this.order, this.max, snap);
  }
  async get() {
    let snaps = this.db.ids(this.path).map((id) => this.doc(id).snap());
    if (this.order) {
      const { field, desc } = this.order;
      snaps = snaps.sort((a, b) => ((a.get(field) as number) - (b.get(field) as number)) * (desc ? -1 : 1) || a.id.localeCompare(b.id));
    }
    if (this.after) snaps = snaps.slice(snaps.findIndex((s) => s.id === this.after!.id) + 1);
    if (this.max !== undefined) snaps = snaps.slice(0, this.max);
    return { docs: snaps };
  }
}
