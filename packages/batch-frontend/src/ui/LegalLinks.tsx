import './LegalLinks.css';

export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Legal">
      <a
        href="https://eslpipeline.com/privacy/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Privacy Policy (opens in a new tab)"
      >
        Privacy Policy
      </a>
      <a
        href="https://eslpipeline.com/terms/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Terms of Service (opens in a new tab)"
      >
        Terms of Service
      </a>
    </nav>
  );
}
