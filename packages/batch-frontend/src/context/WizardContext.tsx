import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { JobConfigOverrides, JobState } from '../utils/api';
import { useAuth } from './AuthContext';

export interface WizardState {
    currentStep: number;
    activeJobId: string | null;
    jobState: JobState | null;
    jobMd: string | null;
    completedJobId: string | null;

    // Workflow artifacts
    recordingId: string | null;
    transcriptId: string | null;
    transcriptText: string;
    transcriptSkipped: boolean;
    promptPackageId: string | null;
    draftId: string | null;
    draftText: string;

    // User inputs
    notes: string;
    templateId: string;
    profileId: string;

    // Configuration
    overrides: JobConfigOverrides;

    // Automation (opt-in)
    automation: WizardAutomationState;
}

export interface WizardAutomationState {
    autoMatchStudent: boolean;
    autoSuggestPrompts: boolean;
    autoDraftPreview: boolean;
    autoPublish: boolean;
}

export type WizardAction =
    | { type: 'SET_STEP'; payload: number }
    | { type: 'SET_JOB'; payload: { id: string | null; state?: JobState; md?: string } }
    | { type: 'SET_RECORDING'; payload: { recordingId: string; transcriptId?: string | null } }
    | { type: 'SET_TRANSCRIPT'; payload: { transcriptId: string; text?: string } }
    | { type: 'SET_TRANSCRIPT_TEXT'; payload: string }
    | { type: 'SET_TRANSCRIPT_ID'; payload: string }
    | { type: 'SET_TRANSCRIPT_SKIPPED'; payload: boolean }
    | { type: 'SET_PROMPT_PACKAGE'; payload: string }
    | { type: 'SET_DRAFT'; payload: { draftId: string; text?: string } }
    | { type: 'SET_DRAFT_TEXT'; payload: string }
    | { type: 'SET_NOTES'; payload: string }
    | { type: 'SET_TEMPLATE'; payload: string }
    | { type: 'SET_PROFILE'; payload: string }
    | { type: 'UPDATE_OVERRIDES'; payload: Partial<JobConfigOverrides> }
    | { type: 'UPDATE_AUTOMATION'; payload: Partial<WizardAutomationState> }
    | { type: 'SET_COMPLETED_JOB'; payload: string | null }
    | { type: 'RESET' }
    | { type: 'HYDRATE_JOB'; payload: Partial<WizardState> };

const initialState: WizardState = {
    currentStep: 0,
    activeJobId: null,
    jobState: null,
    jobMd: null,
    completedJobId: null,
    recordingId: null,
    transcriptId: null,
    transcriptText: '',
    transcriptSkipped: false,
    promptPackageId: null,
    draftId: null,
    draftText: '',
    notes: '',
    templateId: '',
    profileId: '',
    overrides: {
        preset: undefined,
        notionDatabase: undefined,
        withTts: undefined,
        forceTts: undefined,
        ttsStrategy: undefined,
        upload: 'auto',
        voiceId: undefined,
        voiceAccent: undefined,
    },
    automation: {
        autoMatchStudent: false,
        autoSuggestPrompts: false,
        autoDraftPreview: false,
        autoPublish: false,
    },
};

const wizardReducer = (state: WizardState, action: WizardAction): WizardState => {
    switch (action.type) {
        case 'SET_STEP': {
            return { ...state, currentStep: action.payload };
        }
        case 'SET_JOB': {
            return {
                ...state,
                activeJobId: action.payload.id,
                jobState: action.payload.state ?? state.jobState,
                jobMd: action.payload.md ?? state.jobMd,
            };
        }
        case 'SET_RECORDING': {
            return {
                ...state,
                recordingId: action.payload.recordingId,
                transcriptId: action.payload.transcriptId ?? state.transcriptId,
                transcriptSkipped: false,
            };
        }
        case 'SET_TRANSCRIPT': {
            return {
                ...state,
                transcriptId: action.payload.transcriptId,
                transcriptText: action.payload.text ?? state.transcriptText,
                transcriptSkipped: false,
            };
        }
        case 'SET_TRANSCRIPT_TEXT': {
            return { ...state, transcriptText: action.payload, transcriptSkipped: false };
        }
        case 'SET_TRANSCRIPT_ID': {
            return { ...state, transcriptId: action.payload };
        }
        case 'SET_TRANSCRIPT_SKIPPED': {
            return { ...state, transcriptSkipped: action.payload };
        }
        case 'SET_PROMPT_PACKAGE': {
            return { ...state, promptPackageId: action.payload };
        }
        case 'SET_DRAFT': {
            return {
                ...state,
                draftId: action.payload.draftId,
                draftText: action.payload.text ?? state.draftText,
            };
        }
        case 'SET_DRAFT_TEXT': {
            return { ...state, draftText: action.payload };
        }
        case 'SET_NOTES': {
            return { ...state, notes: action.payload };
        }
        case 'SET_TEMPLATE': {
            return { ...state, templateId: action.payload };
        }
        case 'SET_PROFILE': {
            return { ...state, profileId: action.payload };
        }
        case 'UPDATE_OVERRIDES': {
            return { ...state, overrides: { ...state.overrides, ...action.payload } };
        }
        case 'UPDATE_AUTOMATION': {
            return { ...state, automation: { ...state.automation, ...action.payload } };
        }
        case 'SET_COMPLETED_JOB': {
            return { ...state, completedJobId: action.payload };
        }
        case 'RESET': {
            return initialState;
        }
        case 'HYDRATE_JOB': {
            return { ...state, ...action.payload };
        }
        default: {
            return state;
        }
    }
};

interface WizardContextValue {
    state: WizardState;
    dispatch: React.Dispatch<WizardAction>;
    actions: {
        goToStep: (step: number) => void;
        setJob: (id: string | null, state?: JobState, md?: string) => void;
        updateOverrides: (updates: Partial<JobConfigOverrides>) => void;
        updateAutomation: (updates: Partial<WizardAutomationState>) => void;
        reset: () => void;
    };
}

const WizardContext = createContext<WizardContextValue | null>(null);

export const WizardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [state, dispatch] = useReducer(wizardReducer, initialState);
    const didHydrateRef = useRef(false);
    const restoredUserRef = useRef<string | null>(null);
    const lastUserRef = useRef<string | null>(null);

    useEffect(() => {
        if (!user) {
            if (lastUserRef.current) {
                clearStoredWizardState(lastUserRef.current);
                lastUserRef.current = null;
            }
            restoredUserRef.current = null;
            didHydrateRef.current = false;
            return;
        }

        if (restoredUserRef.current === user.id) {
            return;
        }

        const storedState = readStoredWizardState(user.id);
        if (storedState) {
            dispatch({ type: 'HYDRATE_JOB', payload: storedState });
        }

        restoredUserRef.current = user.id;
        lastUserRef.current = user.id;
        didHydrateRef.current = true;
    }, [user]);

    const actions = useMemo(() => ({
        goToStep: (step: number) => dispatch({ type: 'SET_STEP', payload: step }),
        setJob: (id: string | null, state?: JobState, md?: string) =>
            dispatch({ type: 'SET_JOB', payload: { id, state, md } }),
        updateOverrides: (updates: Partial<JobConfigOverrides>) =>
            dispatch({ type: 'UPDATE_OVERRIDES', payload: updates }),
        updateAutomation: (updates: Partial<WizardAutomationState>) =>
            dispatch({ type: 'UPDATE_AUTOMATION', payload: updates }),
        reset: () => {
            dispatch({ type: 'RESET' });
            if (user?.id) {
                clearStoredWizardState(user.id);
            }
        },
    }), [user]);

    useEffect(() => {
        if (!user?.id || !didHydrateRef.current) return;
        persistWizardState(user.id, state);
    }, [state, user]);

    const value = useMemo(() => ({ state, dispatch, actions }), [state, actions]);

    return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
};

export const useWizard = () => {
    const context = useContext(WizardContext);
    if (!context) {
        throw new Error('useWizard must be used within a WizardProvider');
    }
    return context;
};

export function useWizardRouting(stepKeys: string[]) {
    const [searchParams, setSearchParams] = useSearchParams();
    const { state, actions } = useWizard();
    const stateRef = useRef(state);
    const didInitRef = useRef(false);
    const searchString = searchParams.toString();

    const derivedStep = parseStepParam(searchParams.get('step'), stepKeys);
    const jobParam = searchParams.get('jobId');

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        const currentState = stateRef.current;
        if (derivedStep !== currentState.currentStep) {
            actions.goToStep(derivedStep);
        }
        if (jobParam !== currentState.activeJobId) {
            actions.setJob(jobParam || null);
        }
    }, [derivedStep, jobParam, actions]);

    useEffect(() => {
        const params = new URLSearchParams(searchString);
        const hasSeedParams = params.has('step') || params.has('jobId');
        if (!didInitRef.current) {
            didInitRef.current = true;
            if (hasSeedParams) {
                return;
            }
        }
        const stepKey = stepKeys[state.currentStep] ?? stepKeys[0] ?? 'select';
        let changed = false;

        if (params.get('step') !== stepKey) {
            params.set('step', stepKey);
            changed = true;
        }

        if (state.activeJobId) {
            if (params.get('jobId') !== state.activeJobId) {
                params.set('jobId', state.activeJobId);
                changed = true;
            }
        } else if (params.has('jobId')) {
            params.delete('jobId');
            changed = true;
        }

        if (changed) {
            setSearchParams(params, { replace: true });
        }
    }, [state.currentStep, state.activeJobId, searchString, setSearchParams, stepKeys]);
}

const WIZARD_STORAGE_VERSION = 1;
const WIZARD_STORAGE_PREFIX = 'esl-wizard-state';

function buildWizardStorageKey(userId: string): string {
    return `${WIZARD_STORAGE_PREFIX}:${userId}`;
}

function readStoredWizardState(userId: string): Partial<WizardState> | null {
    if (globalThis.window === undefined) return null;
    const key = buildWizardStorageKey(userId);
    try {
        const serialized = globalThis.localStorage.getItem(key);
        if (!serialized) return null;
        const payload = JSON.parse(serialized) as {
            version: number;
            state: WizardState;
        };
        if (payload.version !== WIZARD_STORAGE_VERSION) {
            return null;
        }
        return payload.state;
    } catch (error) {
        console.warn('Failed to parse stored wizard state', error);
        globalThis.localStorage.removeItem(key);
        return null;
    }
}

function persistWizardState(userId: string, state: WizardState): void {
    if (globalThis.window === undefined) return;
    const key = buildWizardStorageKey(userId);
    try {
        const payload = {
            version: WIZARD_STORAGE_VERSION,
            updatedAt: new Date().toISOString(),
            state,
        };
        globalThis.localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to persist wizard state', error);
    }
}

function clearStoredWizardState(userId: string): void {
    if (globalThis.window === undefined) return;
    globalThis.localStorage.removeItem(buildWizardStorageKey(userId));
}

function parseStepParam(value: string | null, stepKeys: string[]): number {
    if (!value) return 0;
    const normalized = value.toLowerCase();
    const index = stepKeys.findIndex((key) => key.toLowerCase() === normalized);
    if (index !== -1) return index;
    const numeric = Number.parseInt(normalized, 10);
    if (!Number.isNaN(numeric)) {
        const zeroBased = numeric - 1;
        if (zeroBased >= 0 && zeroBased < stepKeys.length) {
            return zeroBased;
        }
    }
    return 0;
}
