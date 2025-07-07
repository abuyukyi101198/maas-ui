import type { ReactElement } from "react";

import { GenericTable } from "@canonical/maas-react-components";
import { useSelector } from "react-redux";

import type { RootState } from "@/app/store/root/types";
import type { TagSearchFilter } from "@/app/store/tag/selectors";
import tagSelectors from "@/app/store/tag/selectors";
import useTagsTableColumns from "@/app/tags/components/TagsTable/useTagsTableColumns/useTagsTableColumns";

type TagsTableProps = {
  filter: TagSearchFilter;
  searchText: string;
};

const TagsTable = ({ filter, searchText }: TagsTableProps): ReactElement => {
  // TODO: Implement when v3 with search & filtering is available since React
  //  table breaks the selector access, and cannot be used with Redux state
  const tags = useSelector((state: RootState) =>
    tagSelectors.search(state, searchText, filter)
  );
  const isLoading = useSelector(tagSelectors.loading);

  const columns = useTagsTableColumns();

  return <GenericTable columns={columns} data={tags} isLoading={isLoading} />;
};

export default TagsTable;
