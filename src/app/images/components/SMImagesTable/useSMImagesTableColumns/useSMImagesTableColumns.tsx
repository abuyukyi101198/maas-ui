import { useMemo } from "react";

import { Input } from "@canonical/react-components";
import type { ColumnDef, Row, Getter } from "@tanstack/react-table";
import pluralize from "pluralize";

import type { Image } from "@/app/images/components/SMImagesTable/SMImagesTable";

export type ImageColumnDef = ColumnDef<Image, Partial<Image>>;

const useSMImagesTableColumns = () => {
  // const { setSidePanelContent } = useSidePanel(); // Add after actions are implemented

  return useMemo(
    () =>
      [
        {
          id: "select",
          accessorKey: "id",
          enableSorting: false,
          header: () => <Input type="checkbox" />, // SelectAllCheckbox implementation needed
          cell: ({ row }: { row: Row<Image> }) => {
            return row.getIsGrouped() ? (
              <Input type="checkbox" /> // SelectGroupCheckbox implementation needed
            ) : (
              <label className="p-checkbox--inline">
                <input
                  aria-label={row.original.name}
                  className="p-checkbox__input"
                  type="checkbox"
                  {...{
                    checked: row.getIsSelected(),
                    disabled: !row.getCanSelect(),
                    onChange: row.getToggleSelectedHandler(),
                  }}
                />
                <span className="p-checkbox__label" />
              </label>
            );
          },
        },
        {
          id: "name",
          accessorKey: "name",
          cell: ({
            row,
            getValue,
          }: {
            row: Row<Image>;
            getValue: Getter<Image["name"]>;
          }) => {
            return (
              <div>
                <div>
                  <strong>{getValue()}</strong>
                </div>
                <small className="u-text--muted">
                  {pluralize("image", row.getLeafRows().length ?? 0, true)}{" "}
                </small>
              </div>
            );
          },
        },
        {
          id: "release",
          accessorKey: "release",
          enableSorting: true,
          header: () => "Release title",
        },
        {
          id: "architecture",
          accessorKey: "architecture",
          enableSorting: false,
          header: () => "Architecture",
        },
        {
          id: "size",
          accessorKey: "size",
          enableSorting: false,
          header: () => "Size",
          cell: ({ getValue }: { getValue: Getter<Image["size"]> }) => {
            return <span>{getValue()} MB</span>;
          },
        },
        {
          id: "lastSynced",
          accessorKey: "lastSynced",
          enableSorting: true,
          header: () => "Last synced",
        },
        {
          id: "canDeployToMemory",
          accessorKey: "canDeployToMemory",
          enableSorting: false,
          header: () => "Deployable",
        },
        {
          id: "status",
          accessorKey: "status",
          enableSorting: true,
          header: () => "Status",
        },
        // Add a custom column for actions
      ] as ImageColumnDef[],
    []
  );
};

export default useSMImagesTableColumns;
