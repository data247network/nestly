# Nestly Architecture v2

## Principle
One Supabase-backed family data model serves the parent web portal, parent mobile experience and child device component. Existing household, children, policies, telemetry, usage, notes and command tables remain in place; v2 extends them rather than replacing them.

## Domain modules
1. Identity and household membership
2. Devices and enrolment
3. Policy profiles, assignments and emergency exceptions
4. Routines and routine execution
5. Location and safe zones
6. Chores and rewards
7. Child requests and parent approvals
8. Command delivery and device synchronisation
9. Audit, consent and privacy controls

## Implementation phases
### Phase A — foundation (implemented)
- `devices`
- `policy_profiles`, `policy_assignments`, `policy_exceptions`
- `routines`, `routine_runs`
- `safe_zones`, `device_locations`, `location_events`
- `chores`, `chore_submissions`, `rewards`, `reward_transactions`
- `child_requests`
- `command_delivery`
- `audit_logs`, `consent_records`
- household-bound RLS and realtime surfaces for requests, rewards and latest location

### Phase B — application integration
- Register existing child installations in `devices`
- Resolve active policies from profile + assignment + exception priority
- Record command delivery acknowledgements
- Add request/approval UI to parent and child experiences

### Phase C — policy and routines
- Convert School Mode, Bedtime and Master Lock into policy profiles
- Preserve emergency contacts and emergency applications as higher-priority exceptions
- Add scheduled routine dispatch and idempotent execution tracking

### Phase D — location and engagement
- Write latest location to `device_locations`
- Generate safe-zone entry/exit events
- Add chore submission, review and reward application flows

## Policy precedence
Emergency exceptions > explicit temporary exceptions > active routine > explicit policy assignment > default household policy.

## Command lifecycle
`pending -> claimed -> completed|failed|expired` remains the existing command queue lifecycle. `command_delivery` adds transport-level visibility: `queued -> delivered -> acknowledged` or `failed`.

## Security boundary
Every parent-facing record is scoped to a household and checked through the existing `private.is_household_member(...)` helper. Child-originated writes should continue through authenticated device/claim flows or server-side functions rather than granting broad client write access.

## Next engineering tasks
- Generate database TypeScript types from the deployed schema.
- Add repository services for each v2 domain.
- Integrate the existing screens with v2 state rather than duplicating policy state locally.
- Add tests for policy precedence, command acknowledgement and household isolation.
- Add release gates that verify web and Android builds against the same cloud configuration.
