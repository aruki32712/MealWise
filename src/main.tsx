import React from "react";
import ReactDOM from "react-dom/client";
import MealWiseAccountOnboarding from "./MealWiseAccountOnboarding";
import MealWiseRecipeDiscoveryLauncher from "./MealWiseRecipeDiscoveryLauncher";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MealWiseAccountOnboarding />
    <MealWiseRecipeDiscoveryLauncher />
  </React.StrictMode>
);
