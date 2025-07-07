import { useMemo } from "react";

import { ExternalLink } from "@canonical/maas-react-components";
import { Icon } from "@canonical/react-components";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router";

import TableActions from "@/app/base/components/TableActions";
import TooltipButton from "@/app/base/components/TooltipButton";
import docsUrls from "@/app/base/docsUrls";
import { useSidePanel } from "@/app/base/side-panel-context";
import urls from "@/app/base/urls";
import type { Tag } from "@/app/store/tag/types";
import AppliedTo from "@/app/tags/components/AppliedTo";
import { TagSidePanelViews } from "@/app/tags/constants";
import { formatUtcDatetime } from "@/app/utils/time";

export type TagsColumnDef = ColumnDef<Tag, Partial<Tag>>;

const useTagsTableColumns = (): TagsColumnDef[] => {
  const { setSidePanelContent } = useSidePanel();
  return useMemo(
    () =>
      [
        {
          id: "name",
          accessorKey: "name",
          enableSorting: true,
          header: "Tag name",
          cell: ({
            row: {
              original: { id, name },
            },
          }) => <Link to={urls.tags.tag.index({ id: id })}>{name}</Link>,
        },
        {
          id: "updated",
          accessorKey: "updated",
          enableSorting: true,
          header: "Last update",
          cell: ({
            row: {
              original: { updated },
            },
          }) => formatUtcDatetime(updated),
        },
        {
          id: "definition",
          accessorKey: "definition",
          enableSorting: false,
          header: () => (
            <>
              {"Auto "}
              <TooltipButton
                aria-label="More about automatic tags"
                message={
                  <>
                    Automatic tags are automatically applied to every
                    <br />
                    machine that matches their definition.
                    <br />
                    <ExternalLink
                      className="is-on-dark"
                      to={docsUrls.tagsAutomatic}
                    >
                      Check the documentation about automatic tags.
                    </ExternalLink>
                  </>
                }
                position="top-center"
              />
            </>
          ),
          cell: ({
            row: {
              original: { definition },
            },
          }) =>
            !!definition ? (
              <Icon aria-label="Automatic tag" name="success-grey" />
            ) : null,
        },
        {
          id: "id",
          accessorKey: "id",
          enableSorting: true,
          header: "Applied to",
          cell: ({
            row: {
              original: { id },
            },
          }) => <AppliedTo id={id} />,
        },
        {
          id: "kernel_opts",
          accessorKey: "kernel_opts",
          enableSorting: true,
          header: "Kernel options",
          cell: ({
            row: {
              original: { kernel_opts },
            },
          }) => (!!kernel_opts ? <Icon name="success-grey" /> : null),
        },
        {
          id: "action",
          accessorKey: "id",
          enableSorting: false,
          header: "Action",
          cell: ({
            row: {
              original: { id },
            },
          }) => {
            return (
              <TableActions
                data-testid="tag-actions"
                onDelete={() => {
                  setSidePanelContent({
                    view: TagSidePanelViews.DeleteTag,
                    extras: { id },
                  });
                }}
                onEdit={() => {
                  setSidePanelContent({
                    view: TagSidePanelViews.UpdateTag,
                    extras: {
                      id,
                    },
                  });
                }}
              />
            );
          },
        },
      ] as TagsColumnDef[],
    [setSidePanelContent]
  );
};

export default useTagsTableColumns;
