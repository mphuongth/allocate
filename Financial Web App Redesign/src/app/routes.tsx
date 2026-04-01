import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { AssetOverview } from "./pages/AssetOverview";
import { MonthlyPlan } from "./pages/MonthlyPlan";
import { FundLibrary } from "./pages/FundLibrary";
import { Settings } from "./pages/Settings";

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
    ],
  },
]);
