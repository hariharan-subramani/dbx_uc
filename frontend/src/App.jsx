import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Routes, Route } from "react-router-dom";
import Topbar from "./components/Topbar";
import Explorer from "./components/Explorer";
import UserAccessExplorer from "./components/UserAccessExplorer";
import GovernanceExplorer from "./components/governance/GovernanceExplorer";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function AppContent() {
  const [user, setUser] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/user`)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to reach workspace");
        return response.json();
      })
      .then((data) => setUser(data.user))
      .catch(() => setError("Workspace connection could not be verified."));
  }, []);

  return (
    <div className="app-shell">
      <div className="main">
        <Topbar user={user} />
        <main className="content">
          <div className="breadcrumb"><strong>Privacy Center</strong></div>
          <nav className="module-switcher" aria-label="Privacy Center modules">
            <NavLink to="/" end>Data Explorer</NavLink>
            <NavLink to="/user-access">User Access Explorer</NavLink>
            <NavLink to="/governance">Governance Explorer</NavLink>
          </nav>
          
          {error && <div className="alert" role="alert"><span>!</span>{error}</div>}
          
          <Routes>
            <Route path="/" element={<Explorer user={user} />} />
            <Route path="/user-access" element={<UserAccessExplorer exportedBy={user} />} />
            <Route path="/governance" element={<GovernanceExplorer exportedBy={user} />} />
            <Route path="/workspace/:workspace" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace/catalog/:catalog" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace/catalog/:catalog/schema/:schema" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace/catalog/:catalog/schema/:schema/table/:table" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace/catalog/:catalog/schema/:schema/volume/:volume" element={<Explorer user={user} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
