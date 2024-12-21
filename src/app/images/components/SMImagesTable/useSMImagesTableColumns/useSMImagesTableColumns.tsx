import { useMemo } from "react";

import { formatBytes } from "@canonical/maas-react-components";
import { Icon, Spinner } from "@canonical/react-components";
import type { ColumnDef, Row, Getter } from "@tanstack/react-table";
import pluralize from "pluralize";

import DoubleRow from "@/app/base/components/DoubleRow";
import { useSidePanel } from "@/app/base/side-panel-context";
import RowActions from "@/app/images/components/SMImagesTable/RowActions/RowActions";
import type { Image } from "@/app/images/components/SMImagesTable/SMImagesTable";
import TableCheckbox from "@/app/images/components/SMImagesTable/TableCheckbox/TableCheckbox";
import { ImageSidePanelViews } from "@/app/images/constants";

export type ImageColumnDef = ColumnDef<Image, Partial<Image>>;

const useSMImagesTableColumns = () => {
  const { setSidePanelContent } = useSidePanel(); // Add after actions are implemented

  return useMemo(
    () =>
      [
        {
          id: "select",
          accessorKey: "id",
          enableSorting: false,
          header: ({ table }) => {
            return <TableCheckbox.All table={table} />;
          },
          cell: ({ row }: { row: Row<Image> }) => {
            return row.getIsGrouped() ? (
              <TableCheckbox.Group row={row} />
            ) : (
              <TableCheckbox row={row} />
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
          cell: ({ row }) => {
            let statusIcon;
            switch (row.original.status) {
              case "Synced":
                statusIcon = <Icon aria-label={"synced"} name={"success"} />;
                break;
              default:
                statusIcon = <Spinner />;
                break;
            }
            return (
              <DoubleRow
                data-testid="resource-status"
                icon={statusIcon}
                primary={row.original.status}
                secondary={row.original.lastSynced ?? ""}
              />
            );
          },
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
          cell: ({
            row,
            getValue,
          }: {
            row: Row<Image>;
            getValue: Getter<Image["id"]>;
          }) => {
            const id = getValue();
            return row.getIsGrouped() ? (
              <RowActions.Group row={row} />
            ) : (
              <RowActions
                onDelete={() => {
                  if (id) {
                    if (!row.getIsSelected()) {
                      row.toggleSelected();
                    }
                    setSidePanelContent({
                      view: ImageSidePanelViews.DELETE_IMAGE,
                      // Could not find what extras is for, maybe for deleting the resource alongside the image
                      // extras: {
                      //   bootResource: resource,
                      // },
                    });
                  }
                }}
                row={row}
              />
            );
          },
        },
      ] as ImageColumnDef[],
    [setSidePanelContent]
  );
};

export default useSMImagesTableColumns;
