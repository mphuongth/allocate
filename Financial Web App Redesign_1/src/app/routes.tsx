import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { AssetOverview } from "./pages/AssetOverview";
import { MonthlyPlan } from "./pages/MonthlyPlan";
import { FundLibrary } from "./pages/FundLibrary";
import { Settings } from "./pages/Settings";
import { ModalShowcase } from "./pages/ModalShowcase";
import { NavigationShowcase } from "./pages/NavigationShowcase";
import { LandingPage } from "./pages/LandingPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: AssetOverview },
      { path: "monthly-plan", Component: MonthlyPlan },
      { path: "fund-library", Component: FundLibrary },
      { path: "settings", Component: Settings },
      { path: "settings/goals/:goalId", Component: Settings },
      { path: "modal-showcase", Component: ModalShowcase },
      { path: "navigation-showcase", Component: NavigationShowcase },
    ],
  },
  {
    path: "/landing",
    Component: LandingPage,
  },
  {
    path: "/signin",
    Component: SignInPage,
  },
  {
    path: "/signup",
    Component: SignUpPage,
  },
]);
