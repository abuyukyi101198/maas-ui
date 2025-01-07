import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import configureStore from "redux-mock-store";
import { describe } from "vitest";

import ImagesTableHeader from "./ImagesTableHeader";

import * as sidePanelHooks from "@/app/base/side-panel-context";
import { ImageSidePanelViews } from "@/app/images/constants";
import { bootResourceActions } from "@/app/store/bootresource";
import { BootResourceSourceType } from "@/app/store/bootresource/types";
import type { RootState } from "@/app/store/root/types";
import * as factory from "@/testing/factories";
import {
  userEvent,
  screen,
  within,
  renderWithBrowserRouter,
  expectTooltipOnHover,
  render,
} from "@/testing/utils";

describe("Change sources", () => {
  const setSidePanelContent = vi.fn();

  beforeEach(() => {
    vi.spyOn(sidePanelHooks, "useSidePanel").mockReturnValue({
      setSidePanelContent,
      sidePanelContent: null,
      setSidePanelSize: vi.fn(),
      sidePanelSize: "regular",
    });
  });

  it("can trigger change source side panel form", async () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        ubuntu: factory.bootResourceUbuntu({
          sources: [
            factory.bootResourceUbuntuSource({
              source_type: BootResourceSourceType.MAAS_IO,
            }),
          ],
        }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });

    await userEvent.click(
      screen.getByRole("button", { name: "Change source" })
    );

    expect(setSidePanelContent).toHaveBeenCalledWith({
      view: ImageSidePanelViews.CHANGE_SOURCE,
      extras: { hasSources: true },
    });
  });

  it("renders the change source form and disables closing it if no sources are detected", () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        ubuntu: factory.bootResourceUbuntu({ sources: [] }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });

    expect(setSidePanelContent).toHaveBeenCalledWith({
      view: ImageSidePanelViews.CHANGE_SOURCE,
      extras: { hasSources: false },
    });
  });

  it("renders the correct text for a single default source", () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        ubuntu: factory.bootResourceUbuntu({
          sources: [
            factory.bootResourceUbuntuSource({
              source_type: BootResourceSourceType.MAAS_IO,
            }),
          ],
        }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });
    const images_from = screen.getByText("Showing images synced from");
    expect(within(images_from).getByText("maas.io")).toBeInTheDocument();
  });

  it("renders the correct text for a single custom source", () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        ubuntu: factory.bootResourceUbuntu({
          sources: [
            factory.bootResourceUbuntuSource({
              source_type: BootResourceSourceType.CUSTOM,
              url: "www.url.com",
            }),
          ],
        }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });
    const images_from = screen.getByText("Showing images synced from");
    expect(within(images_from).getByText("www.url.com")).toBeInTheDocument();
  });

  it("renders the correct text for multiple sources", () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        ubuntu: factory.bootResourceUbuntu({
          sources: [
            factory.bootResourceUbuntuSource(),
            factory.bootResourceUbuntuSource(),
          ],
        }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });
    const images_from = screen.getByText("Showing images synced from");
    expect(within(images_from).getByText("sources")).toBeInTheDocument();
  });

  it("disables the button to change source if resources are downloading", async () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        resources: [factory.bootResource({ downloading: true })],
        ubuntu: factory.bootResourceUbuntu({
          sources: [factory.bootResourceUbuntuSource()],
        }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });
    expect(
      screen.getByRole("button", { name: "Change source" })
    ).toBeAriaDisabled();

    await expectTooltipOnHover(
      screen.getByRole("button", { name: "Change source" }),
      "Cannot change source while images are downloading."
    );
  });
});

describe("Download images", () => {
  const setSidePanelContent = vi.fn();

  beforeEach(() => {
    vi.spyOn(sidePanelHooks, "useSidePanel").mockReturnValue({
      setSidePanelContent,
      sidePanelContent: null,
      setSidePanelSize: vi.fn(),
      sidePanelSize: "regular",
    });
  });

  it("can trigger download images side panel form", async () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        ubuntu: factory.bootResourceUbuntu({
          sources: [
            factory.bootResourceUbuntuSource({
              source_type: BootResourceSourceType.MAAS_IO,
            }),
          ],
        }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });

    await userEvent.click(
      screen.getByRole("button", { name: "Download images" })
    );

    expect(setSidePanelContent).toHaveBeenCalledWith({
      view: ImageSidePanelViews.DOWNLOAD_IMAGE,
    });
  });

  it("does not show a button to download images if there are images already downloading", () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        resources: [
          factory.bootResource({ downloading: true, name: "ubuntu/focal" }),
          factory.bootResource({ downloading: false, name: "centos/centos70" }),
        ],
        ubuntu: factory.bootResourceUbuntu(),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, {
      state,
    });

    expect(
      screen.queryByRole("button", { name: "Download images" })
    ).not.toBeInTheDocument();
  });
});

describe("Stop import", () => {
  const mockStore = configureStore<RootState, {}>();

  it("does not show a button to stop importing ubuntu images if none are downloading", () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        resources: [
          factory.bootResource({ downloading: false, name: "ubuntu/focal" }),
          factory.bootResource({ downloading: false, name: "centos/centos70" }),
        ],
        ubuntu: factory.bootResourceUbuntu(),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, {
      state,
    });

    expect(
      screen.queryByRole("button", { name: "Stop import" })
    ).not.toBeInTheDocument();
  });

  it("can dispatch an action to stop importing ubuntu images if at least one is downloading", async () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        resources: [
          factory.bootResource({ downloading: true, name: "ubuntu/focal" }),
        ],
        ubuntu: factory.bootResourceUbuntu(),
      }),
    });
    const store = mockStore(state);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ImagesTableHeader selectedRows={{}} />
        </MemoryRouter>
      </Provider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Stop import" }));

    const expectedAction = bootResourceActions.stopImport();
    const actualActions = store.getActions();
    expect(
      actualActions.find((action) => action.type === expectedAction.type)
    ).toStrictEqual(expectedAction);
  });

  it("enables 'Stop import' button if images are saving", async () => {
    const state = factory.rootState({
      bootresource: factory.bootResourceState({
        resources: [
          factory.bootResource({ downloading: true, name: "ubuntu/focal" }),
        ],
        ubuntu: factory.bootResourceUbuntu(),
        statuses: factory.bootResourceStatuses({ savingUbuntu: true }),
      }),
    });
    renderWithBrowserRouter(<ImagesTableHeader selectedRows={{}} />, { state });
    const stopImportButton = screen.getByRole("button", {
      name: "Stop import",
    });
    expect(stopImportButton).toBeEnabled();
  });
});
