import { prisma } from '../config/prisma';

const courses = [
  { code: 'DA-AI-01', name: 'Data Analytics with AI', description: 'Master data analysis, SQL, PowerBI, Python, and modern AI predictive tools.', feeAmount: 30000.0, durationWeeks: 16 },
  { code: 'DS-AI-01', name: 'Data Science with AI', description: 'Comprehensive Python, Statistics, Machine Learning, Deep Learning, and Generative AI.', feeAmount: 40000.0, durationWeeks: 20 },
  { code: 'BA-AI-01', name: 'Business Analytics with AI', description: 'Strategic business decision making, KPIs, advanced dashboards, and AI automation.', feeAmount: 32000.0, durationWeeks: 14 },
  { code: 'ML-AI-01', name: 'Machine Learning with AI', description: 'Advanced supervised & unsupervised algorithms, PyTorch, TensorFlow, and AI model deployments.', feeAmount: 42000.0, durationWeeks: 18 },
  { code: 'AI-AI-01', name: 'Artificial Intelligence with AI', description: 'Core artificial intelligence architectures, LLMs, prompt engineering, and autonomous agents.', feeAmount: 45000.0, durationWeeks: 20 },
  { code: 'FSD-AI-01', name: 'Full Stack Development with AI', description: 'Full stack development with Next.js, Node.js, databases, and AI coding integration.', feeAmount: 35000.0, durationWeeks: 16 },
  { code: 'GUIDANCE-01', name: 'Not sure yet - need guidance', description: 'Comprehensive curriculum counseling & personalized academic roadmap discussion.', feeAmount: 0.0, durationWeeks: 12 }
];

async function main() {
  // Deactivate old courses
  await prisma.course.updateMany({
    where: { code: { in: ['FSWD-01', 'DSML-01', 'PYFS-01', 'DMGM-01'] } },
    data: { isActive: false }
  });

  for (const c of courses) {
    await prisma.course.upsert({
      where: { code: c.code },
      update: { name: c.name, description: c.description, feeAmount: c.feeAmount, durationWeeks: c.durationWeeks, isActive: true },
      create: { ...c, isActive: true }
    });
  }
  console.log('SUCCESS: Seeded 7 AI courses into database!');
}

main()
  .catch((e) => {
    console.error('ERROR seeding courses:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
