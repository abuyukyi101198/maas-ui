import { useMemo } from "react";

import { formatBytes } from "@canonical/maas-react-components";
import { Icon, Input } from "@canonical/react-components";
import type { ColumnDef, Row, Getter } from "@tanstack/react-table";
import pluralize from "pluralize";

import TableActions from "@/app/base/components/TableActions";
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
                  {pluralize("image", row.getLeafRows().length ?? 0, true)}
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
            const { value, unit } = formatBytes({
              value: getValue(),
              unit: "B",
            });
            return `${value} ${unit}`;
          },
        },
        {
          id: "status",
          accessorKey: "status",
          enableSorting: true,
          header: () => "Status",
          cell: ({ row }) => (
            <div>
              <div>{row.original.status}</div>
              <small className="u-text--muted">
                {row.original.lastSynced ? row.original.lastSynced : ""}
              </small>
            </div>
          ),
        },
        {
          id: "canDeployToMemory",
          accessorKey: "canDeployToMemory",
          enableSorting: false,
          header: () => "Deployable",
          cell: ({
            getValue,
          }: {
            getValue: Getter<Image["canDeployToMemory"]>;
          }) =>
            getValue() ? (
              <Icon aria-label="checked" name="task-outstanding" role="img" />
            ) : null,
        },
        // Add a custom column for actions
        {
          id: "action",
          accessorKey: "id",
          enableSorting: false,
          header: () => "Action",
          cell: () => {
            return (
              <TableActions data-testid="image-actions" deleteDisabled={true} />
            );
          },
        },
      ] as ImageColumnDef[],
    []
  );
};

export default useSMImagesTableColumns;
