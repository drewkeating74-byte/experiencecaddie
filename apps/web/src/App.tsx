import { BrowserRouter, Route, Routes } from "react-router-dom";
import Closed from "./pages/Closed";

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="*" element={<Closed />} />
    </Routes>
  </BrowserRouter>
);

export default App;
