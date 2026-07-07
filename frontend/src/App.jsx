import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Topbar from "./components/Topbar";
import Explorer from "./components/Explorer";
import "./App.css";

function AppContent() {
  const [user, setUser] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("http://127.0.0.1:8000/user")
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
          
          {error && <div className="alert" role="alert"><span>!</span>{error}</div>}
          
          <Routes>
            <Route path="/" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace/catalog/:catalog" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace/catalog/:catalog/schema/:schema" element={<Explorer user={user} />} />
            <Route path="/workspace/:workspace/catalog/:catalog/schema/:schema/table/:table" element={<Explorer user={user} />} />
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
