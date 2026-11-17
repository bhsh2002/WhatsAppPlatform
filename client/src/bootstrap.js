// Dependency evaluation follows this order: install the fetch wrapper before
// evaluating main.jsx and its application imports or captured fetch functions.
import './runtime/browserReleaseBootstrap.js'
import './main.jsx'
