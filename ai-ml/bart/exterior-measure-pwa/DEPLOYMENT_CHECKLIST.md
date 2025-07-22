# BART PWA Production Deployment Checklist

## Pre-Deployment (Friday Before Pilot)

### Infrastructure Verification
- [ ] Verify all AWS resources are provisioned via Terraform
- [ ] Confirm RDS automated backups are configured (90-day retention)
- [ ] Verify S3 lifecycle policies for cold storage are active
- [ ] Check CloudWatch dashboards are accessible
- [ ] Confirm PagerDuty integration is working
- [ ] Verify cost budget alerts are set at $500/month

### Security Checks
- [ ] OAuth 2.0 PKCE flow tested with Salesforce sandbox
- [ ] Verify no hardcoded credentials in codebase
- [ ] Confirm all secrets are in AWS Secrets Manager
- [ ] Check SSL certificates are valid
- [ ] Verify CORS settings for iPad access

### Application Readiness
- [ ] Run all test suites:
  - [ ] `npm run test-oauth` - OAuth flow tests passing
  - [ ] `npm run test-offline` - 48-hour offline sync tests passing
  - [ ] `npm run lint` - No linting errors
  - [ ] `npm run typecheck` - No TypeScript errors
- [ ] Build production bundle: `npm run build`
- [ ] Verify PWA manifest and service worker registration
- [ ] Test offline capabilities on actual iPad

### Data Validation
- [ ] Golden data set (50 historical bids) loaded
- [ ] Run validation script comparing PWA to Excel calculations
- [ ] Verify sync queue is empty
- [ ] Confirm test data is isolated from production

## Deployment Day (Monday Morning)

### 6:00 AM - Pre-Deployment
- [ ] Create manual RDS snapshot: `bart-pilot-pre-deployment-YYYYMMDD`
- [ ] Export current production data to S3
- [ ] Notify pilot users via Slack about deployment window
- [ ] Set maintenance mode if needed

### 7:00 AM - Deployment
- [ ] Deploy application via CI/CD pipeline
- [ ] Verify health endpoint returns 200: `http://localhost:3000/health`
- [ ] Check CloudWatch logs for startup errors
- [ ] Verify database migrations completed successfully

### 8:00 AM - Post-Deployment Validation
- [ ] Run smoke tests:
  - [ ] OAuth login flow works
  - [ ] Can create new bid
  - [ ] Can sync data to Salesforce
  - [ ] Offline mode activates when disconnected
  - [ ] Photos upload successfully
- [ ] Check monitoring dashboards:
  - [ ] API response times < 3s
  - [ ] Error rate < 5%
  - [ ] No memory leaks detected
- [ ] Verify pilot users can access the application

### 9:00 AM - Load Testing
- [ ] Run k6 load test: `npm run test-load`
- [ ] Monitor performance metrics during test
- [ ] Verify auto-scaling triggers if needed
- [ ] Check for any performance degradation

## Pilot Week 1 Daily Checklist

### Daily Morning (8:00 AM)
- [ ] Check CloudWatch dashboards
- [ ] Review error logs from past 24 hours
- [ ] Verify sync queue processing
- [ ] Check disk usage and database connections
- [ ] Review cost tracking dashboard

### Daily Afternoon (4:00 PM)
- [ ] Collect user feedback via Slack
- [ ] Review performance metrics
- [ ] Check for any failed syncs
- [ ] Verify backups completed successfully
- [ ] Update pilot tracking spreadsheet

### End of Day
- [ ] Send daily status email to stakeholders
- [ ] Document any issues in GitHub
- [ ] Plan fixes for next day if needed

## Emergency Rollback Procedure

If critical issues arise:

1. **Immediate Actions**
   - [ ] Notify all pilot users to stop using the system
   - [ ] Execute rollback script: `./scripts/rollback.sh --confirm`
   - [ ] Verify users can access Excel version

2. **Communication**
   - [ ] Send emergency notification to all stakeholders
   - [ ] Post status in #bart-alerts Slack channel
   - [ ] Schedule post-mortem meeting

3. **Recovery**
   - [ ] Restore from latest validated backup
   - [ ] Verify data integrity
   - [ ] Test critical workflows
   - [ ] Get approval before re-enabling access

## Success Criteria

The pilot is considered successful if:
- [ ] 95% uptime maintained
- [ ] Average response time < 3 seconds
- [ ] No data loss incidents
- [ ] Positive feedback from 4/5 estimators
- [ ] Cost remains under $500/month
- [ ] All critical bugs resolved within 24 hours

## Contacts

- **Technical Lead**: tech-lead@kindhome.com
- **Project Manager**: pm@kindhome.com  
- **DevOps On-Call**: devops@kindhome.com / PagerDuty
- **Pilot Coordinator**: pilot@kindhome.com
- **Emergency Escalation**: cto@kindhome.com

## Post-Pilot Actions

After 2-week pilot:
- [ ] Compile metrics report
- [ ] Gather all user feedback
- [ ] Calculate actual vs projected costs
- [ ] Document lessons learned
- [ ] Plan full production rollout
- [ ] Archive pilot data separately