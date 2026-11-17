import { Router, type Router as ExpressRouter, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '@project/db';
import { requireAuth, requireOrgContext, type OrgAuthenticatedRequest } from '../middleware/auth.js';

const router: ExpressRouter = Router();
router.use(requireAuth, requireOrgContext);
type OrgReq = OrgAuthenticatedRequest;
const customerInput = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().max(120).default(''),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).default(''),
  status: z.enum(['Lead', 'Active', 'At Risk']).default('Lead'),
  industry: z.string().trim().max(80).default('Technology'),
});
const dealInput = z.object({
  title: z.string().trim().min(2).max(150),
  customerId: z.string().min(1),
  value: z.coerce.number().min(0).max(100000000),
  stage: z.enum(['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']).default('Lead'),
  probability: z.coerce.number().int().min(0).max(100).default(25),
});
const taskInput = z.object({
  title: z.string().trim().min(2).max(150),
  customerId: z.string().nullable().optional(),
  priority: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  status: z.enum(['Todo', 'In Progress', 'Done']).default('Todo'),
  dueAt: z.string().nullable().optional(),
});
const idSchema = z.string().min(1);
const sendError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: 'Validation error', details: error.flatten() });
  if (error instanceof Error && error.message === 'Customer not found') return res.status(400).json({ success: false, error: error.message });
  console.error('CRM request failed:', error);
  return res.status(500).json({ success: false, error: 'CRM request failed' });
};
async function checkCustomer(id: string | null | undefined, orgId: string) {
  if (!id) return;
  const customer = await prisma.crmCustomer.findFirst({ where: { id, organizationId: orgId } });
  if (!customer) throw new Error('Customer not found');
}

router.get('/overview', async (req: OrgReq, res) => {
  try {
    const organizationId = req.organizationId!;
    const [customers, deals, tasks] = await Promise.all([
      prisma.crmCustomer.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }),
      prisma.crmDeal.findMany({ where: { organizationId }, include: { customer: { select: { name: true, company: true } } }, orderBy: { createdAt: 'desc' } }),
      prisma.crmTask.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const won = deals.filter((d) => d.stage === 'Won');
    const pipeline = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost');
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const dt = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const next = new Date(dt.getFullYear(), dt.getMonth() + 1, 1);
      return {
        label: dt.toLocaleString('en-US', { month: 'short' }),
        revenue: won.filter((d) => d.updatedAt >= dt && d.updatedAt < next).reduce((s, d) => s + d.value, 0),
        customers: customers.filter((c) => c.createdAt >= dt && c.createdAt < next).length,
      };
    });
    res.json({ success: true, data: {
      customers: customers.length, activeCustomers: customers.filter((c) => c.status === 'Active').length,
      openDeals: pipeline.length, pipelineValue: pipeline.reduce((s, d) => s + d.value, 0),
      wonRevenue: won.reduce((s, d) => s + d.value, 0), completedTasks: tasks.filter((t) => t.status === 'Done').length,
      tasksDue: tasks.filter((t) => t.status !== 'Done').length,
      monthly: months,
      stages: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'].map(stage => ({ stage, count: deals.filter(d => d.stage === stage).length })),
      recentCustomers: customers.slice(0, 5), recentDeals: deals.slice(0, 5),
    } });
  } catch (e) { sendError(res, e); }
});
router.get('/customers', async (req: OrgReq, res) => {
  try { res.json({ success: true, data: await prisma.crmCustomer.findMany({ where: { organizationId: req.organizationId! }, orderBy: { createdAt: 'desc' } }) }); }
  catch (e) { sendError(res, e); }
});
router.post('/customers', async (req: OrgReq, res) => {
  try { const data = customerInput.parse(req.body); const item = await prisma.crmCustomer.create({ data: { ...data, organizationId: req.organizationId! } }); res.status(201).json({ success: true, data: item }); }
  catch (e) { sendError(res, e); }
});
router.patch('/customers/:id', async (req: OrgReq, res) => {
  try { const id = idSchema.parse(req.params.id); const data = customerInput.partial().parse(req.body); const result = await prisma.crmCustomer.updateMany({ where: { id, organizationId: req.organizationId! }, data }); if (!result.count) return res.status(404).json({ success: false, error: 'Customer not found' }); res.json({ success: true }); }
  catch (e) { sendError(res, e); }
});
router.delete('/customers/:id', async (req: OrgReq, res) => {
  try { const result = await prisma.crmCustomer.deleteMany({ where: { id: idSchema.parse(req.params.id), organizationId: req.organizationId! } }); if (!result.count) return res.status(404).json({ success: false, error: 'Customer not found' }); res.json({ success: true }); }
  catch (e) { sendError(res, e); }
});
router.get('/deals', async (req: OrgReq, res) => {
  try { res.json({ success: true, data: await prisma.crmDeal.findMany({ where: { organizationId: req.organizationId! }, include: { customer: { select: { name: true, company: true } } }, orderBy: { createdAt: 'desc' } }) }); }
  catch (e) { sendError(res, e); }
});
router.post('/deals', async (req: OrgReq, res) => {
  try { const data = dealInput.parse(req.body); await checkCustomer(data.customerId, req.organizationId!); const item = await prisma.crmDeal.create({ data: { ...data, organizationId: req.organizationId! } }); res.status(201).json({ success: true, data: item }); }
  catch (e) { sendError(res, e); }
});
router.patch('/deals/:id', async (req: OrgReq, res) => {
  try { const id = idSchema.parse(req.params.id); const data = dealInput.partial().parse(req.body); await checkCustomer(data.customerId, req.organizationId!); const result = await prisma.crmDeal.updateMany({ where: { id, organizationId: req.organizationId! }, data }); if (!result.count) return res.status(404).json({ success: false, error: 'Deal not found' }); res.json({ success: true }); }
  catch (e) { sendError(res, e); }
});
router.delete('/deals/:id', async (req: OrgReq, res) => {
  try { const result = await prisma.crmDeal.deleteMany({ where: { id: idSchema.parse(req.params.id), organizationId: req.organizationId! } }); if (!result.count) return res.status(404).json({ success: false, error: 'Deal not found' }); res.json({ success: true }); }
  catch (e) { sendError(res, e); }
});
router.get('/tasks', async (req: OrgReq, res) => {
  try { res.json({ success: true, data: await prisma.crmTask.findMany({ where: { organizationId: req.organizationId! }, include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }) }); }
  catch (e) { sendError(res, e); }
});
router.post('/tasks', async (req: OrgReq, res) => {
  try { const { dueAt, ...data } = taskInput.parse(req.body); await checkCustomer(data.customerId, req.organizationId!); const item = await prisma.crmTask.create({ data: { ...data, dueAt: dueAt ? new Date(dueAt) : null, organizationId: req.organizationId! } }); res.status(201).json({ success: true, data: item }); }
  catch (e) { sendError(res, e); }
});
router.patch('/tasks/:id', async (req: OrgReq, res) => {
  try { const id = idSchema.parse(req.params.id); const { dueAt, ...data } = taskInput.partial().parse(req.body); await checkCustomer(data.customerId, req.organizationId!); const result = await prisma.crmTask.updateMany({ where: { id, organizationId: req.organizationId! }, data: { ...data, ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}) } }); if (!result.count) return res.status(404).json({ success: false, error: 'Task not found' }); res.json({ success: true }); }
  catch (e) { sendError(res, e); }
});
router.delete('/tasks/:id', async (req: OrgReq, res) => {
  try { const result = await prisma.crmTask.deleteMany({ where: { id: idSchema.parse(req.params.id), organizationId: req.organizationId! } }); if (!result.count) return res.status(404).json({ success: false, error: 'Task not found' }); res.json({ success: true }); }
  catch (e) { sendError(res, e); }
});
// Seed only in development and only for an authenticated member's current organization.
router.post('/seed-demo', async (req: OrgReq, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ success: false, error: 'Not found' });
  try {
    const organizationId = req.organizationId!;
    const count = await prisma.crmCustomer.count({ where: { organizationId } });
    if (count) return res.status(409).json({ success: false, error: 'This workspace already has CRM customers. Demo seed was not applied.' });
    const names = [
      ['Olivia Carter', 'Northstar Labs', 'olivia@northstar.example', 'Active', 'Technology'],
      ['Marcus Lee', 'Apex Ventures', 'marcus@apex.example', 'Active', 'Finance'],
      ['Sophia Bennett', 'Brightline Studio', 'sophia@brightline.example', 'Lead', 'Creative'],
      ['Noah Williams', 'Elevate Health', 'noah@elevate.example', 'Active', 'Healthcare'],
      ['Emma Rodriguez', 'Summit Cloud', 'emma@summit.example', 'At Risk', 'Technology'],
      ['Liam Patel', 'Clearpath Media', 'liam@clearpath.example', 'Lead', 'Marketing'],
      ['Ava Thompson', 'Verde Commerce', 'ava@verde.example', 'Active', 'eCommerce'],
      ['Ethan Brooks', 'Momentum Co', 'ethan@momentum.example', 'Lead', 'Consulting'],
    ] as const;
    const stages = ['Won', 'Qualified', 'Proposal', 'Negotiation', 'Lead', 'Won', 'Proposal', 'Qualified'] as const;
    const amounts = [12500, 8400, 16200, 24500, 6100, 9300, 18900, 7200];
    for (let i = 0; i < names.length; i++) {
      const [name, company, email, status, industry] = names[i];
      const customer = await prisma.crmCustomer.create({ data: { name, company, email, status, industry, organizationId, createdAt: new Date(Date.now() - (i * 15 + 3) * 86400000) } });
      await prisma.crmDeal.create({ data: { title: `${company} partnership`, customerId: customer.id, organizationId, stage: stages[i], value: amounts[i], probability: stages[i] === 'Won' ? 100 : 30 + i * 7 } });
      await prisma.crmTask.create({ data: { title: ['Prepare proposal', 'Schedule discovery call', 'Review contract', 'Send onboarding guide'][i % 4] + ` · ${company}`, customerId: customer.id, organizationId, priority: i % 3 === 0 ? 'High' : 'Medium', status: i % 4 === 0 ? 'Done' : i % 3 === 0 ? 'In Progress' : 'Todo', dueAt: new Date(Date.now() + (i - 2) * 86400000) } });
    }
    res.status(201).json({ success: true, message: 'Added 8 sample customers, deals and tasks. All sample email addresses use .example.' });
  } catch (e) { sendError(res, e); }
});
export default router;
