// packages/batch-backend/src/application/job-actions/cancel-job.ts
//
// Handler for job cancellation action (stub implementation)

import type { CancelJobAction, JobActionResult } from '../../domain/job-actions';
import { JobActionType } from '../../domain/job-actions';
import { getJobById } from '../../domain/job-repository';

/**
 * Cancel a queued or running job
 * 
 * @param jobId - ID of the job to cancel
 * @param action - Cancel action with optional reason
 * @returns Action result indicating success/failure
 * 
 * TODO: Implement actual cancellation logic:
 * 1. Check if job is cancellable (queued or running only)
 * 2. Remove from BullMQ queue if queued
 * 3. Signal running worker to abort gracefully
 * 4. Update job state to 'cancelled'
 * 5. Emit job_state_changed event
 */
export async function cancelJob(
    jobId: string,
    _action: CancelJobAction
): Promise<JobActionResult> {
    // Verify job exists
    const job = await getJobById(jobId);
    if (!job) {
        return {
            success: false,
            message: 'Job not found',
            jobId,
            actionType: JobActionType.CANCEL,
            timestamp: new Date(),
            error: 'not_found',
        };
    }

    // TODO: Implement cancellation logic
    // For now, return not_implemented stub response
    return {
        success: false,
        message: 'Job cancellation not yet implemented',
        jobId,
        actionType: JobActionType.CANCEL,
        timestamp: new Date(),
        error: 'not_implemented',
    };
}
