import type { GenericState } from "app/store/types/state";
import type { Model } from "app/store/types/model";
import type { TSFixMe } from "app/base/types";

export type Tag = Model & {
  created: string;
  updated: string;
  name: string;
  definition: string;
  comment: string;
  kernel_opts: string | null;
};

export type TagState = GenericState<Tag, TSFixMe>;
