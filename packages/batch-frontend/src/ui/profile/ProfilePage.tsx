import React, { useState } from 'react';
import toast from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';

// Icons
const UserIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);

const KeyIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
);

const DatabaseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
);

const VolumeIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
);

const CloudIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
);

const ShieldIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const SaveIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
    </svg>
);

const EyeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeOffIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

interface ProfilePageProps {
    onClose: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onClose }) => {
    const { user } = useAuth();

    // Stub state for API keys (will be loaded from backend later)
    const [elevenLabsKey, setElevenLabsKey] = useState('');
    const [notionToken, setNotionToken] = useState('');
    const [s3AccessKey, setS3AccessKey] = useState('');
    const [s3SecretKey, setS3SecretKey] = useState('');
    const [s3Bucket, setS3Bucket] = useState('');
    const [s3Endpoint, setS3Endpoint] = useState('');

    // Show/hide toggles for sensitive fields
    const [showElevenLabs, setShowElevenLabs] = useState(false);
    const [showNotion, setShowNotion] = useState(false);
    const [showS3Secret, setShowS3Secret] = useState(false);

    // Preferences
    const [defaultPreset, setDefaultPreset] = useState('b1-default');
    const [defaultVoiceAccent, setDefaultVoiceAccent] = useState('american');
    const [defaultTtsMode, setDefaultTtsMode] = useState<'auto' | 'dialogue' | 'monologue'>('auto');
    const [enableNotifications, setEnableNotifications] = useState(true);

    const handleSave = () => {
        // TODO: Implement save to backend
        toast.success('Settings saved (stub - not yet implemented)');
    };

    return (
        <div className="profile-page">
            <header className="profile-header">
                <button type="button" onClick={onClose} className="back-button">
                    ← Back to Dashboard
                </button>
                <div className="profile-title">
                    <div className="profile-avatar">
                        <UserIcon />
                    </div>
                    <div>
                        <h1>Profile Settings</h1>
                        <p className="profile-email">{user?.email}</p>
                    </div>
                </div>
            </header>

            <div className="profile-sections">
                {/* Account Section */}
                <section className="settings-section card">
                    <div className="section-header">
                        <ShieldIcon />
                        <div>
                            <h2>Account</h2>
                            <p>Manage your account details</p>
                        </div>
                    </div>
                    <div className="section-content">
                        <div className="form-field">
                            <label>Email</label>
                            <input type="email" value={user?.email ?? ''} disabled className="field-disabled" />
                            <span className="field-hint">Contact support to change your email</span>
                        </div>
                        <div className="form-field">
                            <label>Role</label>
                            <input type="text" value={user?.role ?? 'user'} disabled className="field-disabled" />
                        </div>
                    </div>
                </section>

                {/* ElevenLabs Section */}
                <section className="settings-section card">
                    <div className="section-header">
                        <VolumeIcon />
                        <div>
                            <h2>ElevenLabs TTS</h2>
                            <p>Configure text-to-speech generation</p>
                        </div>
                    </div>
                    <div className="section-content">
                        <div className="form-field">
                            <label>API Key</label>
                            <div className="input-with-toggle">
                                <input
                                    type={showElevenLabs ? 'text' : 'password'}
                                    value={elevenLabsKey}
                                    onChange={(e) => setElevenLabsKey(e.target.value)}
                                    placeholder="sk_..."
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowElevenLabs(!showElevenLabs)}
                                    className="toggle-visibility"
                                >
                                    {showElevenLabs ? <EyeOffIcon /> : <EyeIcon />}
                                </button>
                            </div>
                            <span className="field-hint">Your ElevenLabs API key for voice generation</span>
                        </div>
                        <div className="form-field">
                            <label>Default TTS Mode</label>
                            <select
                                value={defaultTtsMode}
                                onChange={(e) => setDefaultTtsMode(e.target.value as 'auto' | 'dialogue' | 'monologue')}
                            >
                                <option value="auto">Auto (detect from content)</option>
                                <option value="dialogue">Dialogue (multi-speaker)</option>
                                <option value="monologue">Monologue (single speaker)</option>
                            </select>
                        </div>
                        <div className="form-field">
                            <label>Default Voice Accent</label>
                            <select
                                value={defaultVoiceAccent}
                                onChange={(e) => setDefaultVoiceAccent(e.target.value)}
                            >
                                <option value="american">American</option>
                                <option value="british">British</option>
                                <option value="australian">Australian</option>
                                <option value="indian">Indian</option>
                            </select>
                        </div>
                    </div>
                </section>

                {/* Notion Section */}
                <section className="settings-section card">
                    <div className="section-header">
                        <DatabaseIcon />
                        <div>
                            <h2>Notion Integration</h2>
                            <p>Connect to your Notion workspace</p>
                        </div>
                    </div>
                    <div className="section-content">
                        <div className="form-field">
                            <label>Integration Token</label>
                            <div className="input-with-toggle">
                                <input
                                    type={showNotion ? 'text' : 'password'}
                                    value={notionToken}
                                    onChange={(e) => setNotionToken(e.target.value)}
                                    placeholder="secret_..."
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNotion(!showNotion)}
                                    className="toggle-visibility"
                                >
                                    {showNotion ? <EyeOffIcon /> : <EyeIcon />}
                                </button>
                            </div>
                            <span className="field-hint">
                                Create an integration at{' '}
                                <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer">
                                    notion.so/my-integrations
                                </a>
                            </span>
                        </div>
                    </div>
                </section>

                {/* S3 Storage Section */}
                <section className="settings-section card">
                    <div className="section-header">
                        <CloudIcon />
                        <div>
                            <h2>S3 Storage</h2>
                            <p>Configure cloud storage for audio files</p>
                        </div>
                    </div>
                    <div className="section-content">
                        <div className="form-row">
                            <div className="form-field">
                                <label>Access Key ID</label>
                                <input
                                    type="text"
                                    value={s3AccessKey}
                                    onChange={(e) => setS3AccessKey(e.target.value)}
                                    placeholder="AKIA..."
                                />
                            </div>
                            <div className="form-field">
                                <label>Secret Access Key</label>
                                <div className="input-with-toggle">
                                    <input
                                        type={showS3Secret ? 'text' : 'password'}
                                        value={s3SecretKey}
                                        onChange={(e) => setS3SecretKey(e.target.value)}
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowS3Secret(!showS3Secret)}
                                        className="toggle-visibility"
                                    >
                                        {showS3Secret ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-field">
                                <label>Bucket Name</label>
                                <input
                                    type="text"
                                    value={s3Bucket}
                                    onChange={(e) => setS3Bucket(e.target.value)}
                                    placeholder="my-audio-bucket"
                                />
                            </div>
                            <div className="form-field">
                                <label>Endpoint (optional)</label>
                                <input
                                    type="text"
                                    value={s3Endpoint}
                                    onChange={(e) => setS3Endpoint(e.target.value)}
                                    placeholder="https://s3.amazonaws.com"
                                />
                                <span className="field-hint">For S3-compatible services like MinIO</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Preferences Section */}
                <section className="settings-section card">
                    <div className="section-header">
                        <KeyIcon />
                        <div>
                            <h2>Preferences</h2>
                            <p>Default settings for new jobs</p>
                        </div>
                    </div>
                    <div className="section-content">
                        <div className="form-field">
                            <label>Default Color Preset</label>
                            <select
                                value={defaultPreset}
                                onChange={(e) => setDefaultPreset(e.target.value)}
                            >
                                <option value="b1-default">B1 Default</option>
                                <option value="a2-beginner">A2 Beginner</option>
                                <option value="b2-intermediate">B2 Intermediate</option>
                                <option value="c1-advanced">C1 Advanced</option>
                            </select>
                        </div>
                        <div className="form-field toggle-row">
                            <div className="toggle-info">
                                <label>Browser Notifications</label>
                                <span className="field-hint">Get notified when jobs complete</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEnableNotifications(!enableNotifications)}
                                className={`toggle-switch ${enableNotifications ? 'active' : ''}`}
                            >
                                <span className="toggle-thumb" />
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            <footer className="profile-footer">
                <button type="button" onClick={onClose} className="btn-secondary">
                    Cancel
                </button>
                <button type="button" onClick={handleSave} className="btn-primary">
                    <SaveIcon />
                    Save Changes
                </button>
            </footer>

            <style>{`
        .profile-page {
          max-width: 800px;
          margin: 0 auto;
          padding: var(--space-6);
          animation: fadeIn 0.3s ease-out;
        }

        .profile-header {
          margin-bottom: var(--space-8);
        }

        .back-button {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: var(--text-sm);
          cursor: pointer;
          margin-bottom: var(--space-4);
          transition: color var(--transition-fast);
        }

        .back-button:hover {
          color: var(--color-primary-500);
        }

        .profile-title {
          display: flex;
          align-items: center;
          gap: var(--space-4);
        }

        .profile-avatar {
          width: 64px;
          height: 64px;
          background: var(--gradient-primary);
          border-radius: var(--radius-xl);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .profile-title h1 {
          font-size: var(--text-2xl);
          margin: 0;
        }

        .profile-email {
          color: var(--text-secondary);
          margin: var(--space-1) 0 0;
        }

        .profile-sections {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        .settings-section {
          padding: var(--space-6);
        }

        .section-header {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          margin-bottom: var(--space-5);
          padding-bottom: var(--space-4);
          border-bottom: 1px solid var(--border-light);
        }

        .section-header svg {
          color: var(--color-primary-500);
          flex-shrink: 0;
          margin-top: 2px;
        }

        .section-header h2 {
          font-size: var(--text-lg);
          margin: 0;
        }

        .section-header p {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
          margin: var(--space-1) 0 0;
        }

        .section-content {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-4);
        }

        @media (max-width: 640px) {
          .form-row {
            grid-template-columns: 1fr;
          }
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .form-field label {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .form-field input,
        .form-field select {
          padding: var(--space-3) var(--space-4);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          font-size: var(--text-sm);
          color: var(--text-primary);
          transition: all var(--transition-fast);
        }

        .form-field input:focus,
        .form-field select:focus {
          outline: none;
          border-color: var(--color-primary-400);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        .form-field input.field-disabled {
          background: var(--bg-tertiary);
          color: var(--text-tertiary);
          cursor: not-allowed;
        }

        .field-hint {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .field-hint a {
          color: var(--color-primary-500);
        }

        .input-with-toggle {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-with-toggle input {
          width: 100%;
          padding-right: var(--space-12);
        }

        .toggle-visibility {
          position: absolute;
          right: var(--space-2);
          padding: var(--space-2);
          background: none;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          border-radius: var(--radius-md);
          transition: all var(--transition-fast);
        }

        .toggle-visibility:hover {
          color: var(--text-primary);
          background: var(--bg-tertiary);
        }

        .toggle-row {
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-4);
          background: var(--bg-secondary);
          border-radius: var(--radius-lg);
        }

        .toggle-info {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .toggle-switch {
          position: relative;
          width: 48px;
          height: 26px;
          background: var(--color-gray-300);
          border: none;
          border-radius: var(--radius-full);
          padding: 0;
          cursor: pointer;
          transition: background var(--transition-fast);
          flex-shrink: 0;
        }

        .toggle-switch.active {
          background: var(--color-primary-500);
        }

        .toggle-switch .toggle-thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          display: block;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          box-shadow: var(--shadow-sm);
          transition: transform var(--transition-fast);
        }

        .toggle-switch.active .toggle-thumb {
          transform: translateX(22px);
        }

        .profile-footer {
          display: flex;
          justify-content: flex-end;
          gap: var(--space-3);
          margin-top: var(--space-8);
          padding-top: var(--space-6);
          border-top: 1px solid var(--border-light);
        }

        .btn-secondary {
          padding: var(--space-3) var(--space-6);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          color: var(--text-secondary);
          font-size: var(--text-sm);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-secondary:hover {
          background: var(--bg-tertiary);
          border-color: var(--border-medium);
        }
      `}</style>
        </div>
    );
};
