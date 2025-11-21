// packages/batch-backend/src/application/job-actions/rerun-audio.ts
//
// Handler for audio regeneration action (stub implementation)

import type { RerunAudioAction, JobActionResult } from '../../domain/job-actions';
import { JobActionType } from '../../domain/job-actions';
import { getJobById } from '../../domain/job-repository';

/**
 * Rerun audio generation for a job
 * 
 * @param jobId - ID of the job to rerun audio for
 * @param action - Rerun audio action with payload
 * @returns Action result indicating success/failure
 * 
 * TODO: Implement actual audio rerun logic:
 * 1. Validate job state (must be completed successfully)
 * 2. Call orchestrator with rerunAssignment
 * 3. Update job state or create new job reference
 * 4. Emit job_state_changed event
 * 5. Return success with updated job data
 */
export async function rerunAudio(
    jobId: string,
    _action: RerunAudioAction
): Promise<JobActionResult> {
    // Verify job exists
    const job = await getJobById(jobId);
    if (!job) {
        return {
            success: false,
            message: 'Job not found',
            jobId,
            actionType: JobActionType.RERUN_AUDIO,
            timestamp: new Date(),
            error: 'not_found',
        };
    }

    // TODO: Implement actual audio rerun logic
    // For now, return not_implemented stub response
    return {
        success: false,
        message: 'Audio rerun not yet implemented',
        jobId,
        actionType: JobActionType.RERUN_AUDIO,
        timestamp: new Date(),
        error: 'not_implemented',
    };
}
