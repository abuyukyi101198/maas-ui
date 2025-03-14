import type { BootResource } from "./types";

export const splitResourceName = (
  name: BootResource["name"]
): { os: string; release: string } => {
  const split = name.split("/");
  if (name.length === 0) {
    return { os: "", release: "" };
  }
  return split.length > 1
    ? { os: split[0], release: split[1] }
    : { os: "other", release: name };
};

export const splitImageName = (
  name: string
): { os: string; arch: string; subArch: string; release: string } => {
  const split = name.split("/");
  return split.length === 4
    ? { os: split[0], arch: split[1], subArch: split[2], release: split[3] }
    : { os: "", arch: "", subArch: "", release: "" };
};
