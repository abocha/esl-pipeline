import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import './BusinessDashboard.css';
export const BusinessShell: React.FC = () => {
  return (
    <section className="business-dashboard-page">
      <header className="business-dashboard-header">
        <div>
          <h1>Business</h1>
        </div>
        <nav className="business-dashboard-tabs" aria-label="Business">
          <NavLink
            to="/business/schedule"
            className={({ isActive }) =>
              isActive ? 'business-dashboard-tab active' : 'business-dashboard-tab'
            }
          >
            My Schedule
          </NavLink>
          <NavLink
            to="/business/stats"
            className={({ isActive }) =>
              isActive ? 'business-dashboard-tab active' : 'business-dashboard-tab'
            }
          >
            Stats
          </NavLink>
          <NavLink
            to="/business/settings"
            className={({ isActive }) =>
              isActive ? 'business-dashboard-tab active' : 'business-dashboard-tab'
            }
          >
            Settings
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </section>
  );
};
