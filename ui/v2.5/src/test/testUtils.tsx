import React, { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IntlProvider } from "react-intl";
import { MockedProvider, MockedResponse } from "@apollo/client/testing";
import { ThemeProvider, createTheme } from "@mui/material/styles";

// Default theme for testing
const testTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

interface AllProvidersProps {
  children: React.ReactNode;
  mocks?: MockedResponse[];
  initialEntries?: string[];
}

/**
 * Wrapper with all necessary providers for testing
 */
export const AllProviders: React.FC<AllProvidersProps> = ({
  children,
  mocks = [],
  initialEntries = ["/"],
}) => {
  return (
    <MockedProvider mocks={mocks} addTypename={false}>
      <IntlProvider locale="en" messages={{}}>
        <MemoryRouter initialEntries={initialEntries}>
          <ThemeProvider theme={testTheme}>{children}</ThemeProvider>
        </MemoryRouter>
      </IntlProvider>
    </MockedProvider>
  );
};

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  mocks?: MockedResponse[];
  initialEntries?: string[];
}

/**
 * Custom render function that wraps components with all providers
 */
export const customRender = (
  ui: ReactElement,
  options?: CustomRenderOptions
) => {
  const { mocks, initialEntries, ...renderOptions } = options || {};

  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders mocks={mocks} initialEntries={initialEntries}>
        {children}
      </AllProviders>
    ),
    ...renderOptions,
  });
};

// Re-export everything from testing-library
export * from "@testing-library/react";
export { customRender as render };
