import useImageTableColumns from "@/app/images/components/SMImagesTable/useImageTableColumns/useImageTableColumns";
import { screen, renderHook, render, waitFor } from "@/testing/utils";

vi.mock("@/context", async () => {
  const actual = await vi.importActual("@/context");
  return {
    ...actual!,
    useAppLayoutContext: () => ({
      setSidebar: vi.fn(),
    }),
  };
});

const setupTestCase = (name = "test-row") => {
  const commissioningRelease: string | null = "20.04";
  const { result } = renderHook(() =>
    // @ts-ignore
    useImageTableColumns(commissioningRelease)
  );
  const props = {
    getValue: () => name,
    row: {
      original: {
        name,
        resource: {
          name,
        },
      },
      getIsSelected: vi.fn(() => false),
      getCanSelect: vi.fn(() => true),
      getToggleSelectedHandler: vi.fn(() => () => {}),
      getIsGrouped: vi.fn(() => false),
    },
  };

  return { result, props };
};

it("returns the correct number of columns", () => {
  const { result } = setupTestCase();
  expect(result.current).toBeInstanceOf(Array);
  expect(result.current.map((column) => column.id)).toStrictEqual([
    "select",
    "name",
    "release",
    "architecture",
    "size",
    "status",
    "canDeployToMemory",
    "action",
  ]);
});

it("input has correct accessible label", () => {
  const { result, props } = setupTestCase("Ubuntu");

  const selectColumn = result.current.find((column) => column.id === "select");
  // @ts-ignore-next-line
  const cellValue = selectColumn.cell(props);
  render(cellValue);

  const inputElement = screen.getByRole("checkbox");
  expect(inputElement).toHaveAccessibleName("Ubuntu");
});

it("action column toggles row selection on delete", async () => {
  const toggleSelected = vi.fn();
  const { result, props } = setupTestCase();

  const actionColumn = result.current.find((column) => column.id === "action");
  render(
    // @ts-ignore-next-line
    actionColumn.cell({ ...props, row: { ...props.row, toggleSelected } })
  );
  screen.getByTestId("row-delete").click();

  await waitFor(() => expect(toggleSelected).toHaveBeenCalled());
});
