/**
 * 猎聘 CLI 通用工具函数
 */

import { Page } from 'puppeteer-core';

/** 猎聘域名 */
export const LIEPIN_DOMAIN = 'www.liepin.com';
export const LIEPIN_API = 'https://api-c.liepin.com';
export const LIEPIN_LPT_API = 'https://api-lpt.liepin.com';
export const LIEPIN_IM_API = 'https://api-im.liepin.com';

/** 城市代码映射 */
export const CITY_CODES: Record<string, string> = {
  '全国': '410', 'all': '410',
  '北京': '010', 'beijing': '010',
  '上海': '020', 'shanghai': '020',
  '天津': '030', 'tianjin': '030',
  '重庆': '040', 'chongqing': '040',
  '广州': '050020', 'guangzhou': '050020',
  '深圳': '050090', 'shenzhen': '050090',
  '苏州': '060080', 'suzhou': '060080',
  '南京': '060020', 'nanjing': '060020',
  '杭州': '070020', 'hangzhou': '070020',
  '大连': '210040', 'dalian': '210040',
  '成都': '280020', 'chengdu': '280020',
  '武汉': '170020', 'wuhan': '170020',
  '西安': '270020', "xi'an": '270020', 'xian': '270020',
  '长沙': '180020', 'changsha': '180020',
  '郑州': '150020', 'zhengzhou': '150020',
  '青岛': '120020', 'qingdao': '120020',
  '合肥': '080020', 'hefei': '080020',
  '厦门': '110030', 'xiamen': '110030',
  '无锡': '060030', 'wuxi': '060030',
  '济南': '120030', 'jinan': '120030',
  '佛山': '050060', 'foshan': '050060',
  '东莞': '050070', 'dongguan': '050070',
  '宁波': '070030', 'ningbo': '070030',
  '福州': '110020', 'fuzhou': '110020',
  '昆明': '250020', 'kunming': '250020',
  '沈阳': '220020', 'shenyang': '220020',
  '哈尔滨': '230020', 'haerbin': '230020', 'harbin': '230020',
  '石家庄': '160020', 'shijiazhuang': '160020',
  '贵阳': '260020', 'guiyang': '260020',
  '南宁': '200020', 'nanning': '200020',
  '南昌': '090020', 'nanchang': '090020',
  '长春': '240020', 'changchun': '240020',
  '太原': '140020', 'taiyuan': '140020',
  '兰州': '290020', 'lanzhou': '290020',
  '乌鲁木齐': '310020', 'urumqi': '310020',
  '海口': '300020', 'haikou': '300020',
  '香港': '100', 'hongkong': '100', 'hk': '100',
};

/** 工作经验代码 */
export const WORKYEAR_CODES: Record<string, string> = {
  '不限': '',
  '应届': '1', '应届生': '1',
  '实习': '2', '实习生': '2',
  '1年以内': '0$1',
  '1-3年': '1$3',
  '3-5年': '3$5',
  '5-10年': '5$10',
  '10年以上': '10$999',
};

/** 薪资代码 */
export const SALARY_CODES: Record<string, { low: string; high: string }> = {
  '不限': { low: '', high: '' },
  '3K以下': { low: '0', high: '3' },
  '3-5K': { low: '3', high: '5' },
  '5-10K': { low: '5', high: '10' },
  '10-15K': { low: '10', high: '15' },
  '15-20K': { low: '15', high: '20' },
  '20-30K': { low: '20', high: '30' },
  '30-50K': { low: '30', high: '50' },
  '50K以上': { low: '50', high: '' },
};

/** 年薪代码 */
export const YEARSALARY_CODES: Record<string, string> = {
  '不限': '',
  '10万以下': '1', '10-15万': '2', '16-20万': '3',
  '21-30万': '4', '31-50万': '5', '51-100万': '6', '100万以上': '7',
};

/** 学历代码 */
export const DEGREE_CODES: Record<string, string> = {
  '不限': '',
  '博士': '010', '硕士': '030', '本科': '040',
  '大专': '050', '中专': '060', '中技': '060', '中专/中技': '060',
  '高中': '080', '初中及以下': '090',
};

/** 行业代码 */
export const INDUSTRY_CODES: Record<string, string> = {
  '互联网': '010',
  '金融': '020',
  '房地产': '030',
  '教育': '040',
  '医疗': '050',
  '制造': '060',
  '消费': '070',
  '企业服务': '080',
  '文娱': '090',
  '汽车': '100',
  '物流': '110',
  '电商': '120',
  '社交': '130',
  '游戏': '140',
  '人工智能': '150',
  '区块链': '160',
  '新能源': '170',
  '硬件': '180',
  '软件': '190',
  '广告': '200',
  '旅游': '210',
  '餐饮': '220',
  '零售': '230',
  '农业': '240',
  '建筑': '250',
  '环保': '260',
  '体育': '270',
  '政府': '280',
  '非营利': '290',
  '其他': '999',
};

/** 公司规模代码 */
export const COMPSIZE_CODES: Record<string, string> = {
  '不限': '',
  '0-20人': '1',
  '20-99人': '2',
  '100-499人': '3',
  '500-999人': '4',
  '1000-9999人': '5',
  '10000人以上': '6',
};

/** 职位类型代码 */
export const JOBKIND_CODES: Record<string, string> = {
  '不限': '',
  '猎头': '1',
  '企业': '2',
};

/** 解析城市代码 */
export function resolveCity(city: string): string {
  if (!city) return CITY_CODES['全国'];
  const normalized = city.toLowerCase().trim();
  return CITY_CODES[normalized] || city;
}

/** 解析代码映射 */
export function resolveCode(value: string, codeMap: Record<string, string>): string {
  if (!value) return '';
  const normalized = value.trim();
  return normalized in codeMap ? codeMap[normalized] : value;
}

/** 解析薪资 */
export function resolveSalary(salary: string): { low: string; high: string } {
  if (!salary) return { low: '', high: '' };
  const normalized = salary.trim();
  return SALARY_CODES[normalized] || { low: '', high: '' };
}

/** 随机延迟 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 随机延迟（人类行为模拟） */
export function sleepRandom(min: number = 500, max: number = 1500): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(delay);
}

/** 要求页面已初始化 */
export function requirePage(page: Page | null): asserts page is Page {
  if (!page) {
    throw new Error('页面未初始化。请先调用 launch() 或 navigate()。');
  }
}

/** 导航到猎聘页面 */
export async function navigateTo(page: Page, path: string): Promise<void> {
  const url = path.startsWith('http') ? path : `https://${LIEPIN_DOMAIN}${path}`;
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleepRandom();
}

/** 猎聘 API 请求 (api-c.liepin.com / 老 www.liepin.com 域)
 *
 * 与 lptFetch 行为对齐:
 *   - try/catch, 不再裸抛 "Failed to fetch"
 *   - 非 2xx 直接抛带状态码的错误
 *   - 非 JSON 响应抛"可能是反爬虫挑战"
 */
export async function liepinFetch(page: Page, url: string, options: RequestInit = {}): Promise<any> {
  const result = await page.evaluate(async (fetchUrl, fetchOptions) => {
    try {
      const res = await fetch(fetchUrl, {
        credentials: 'include',
        ...fetchOptions,
        headers: {
          'Content-Type': 'application/json',
          'x-xsrf-token': document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || '',
          ...fetchOptions.headers,
        },
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (e: any) {
      return { ok: false, status: 0, text: '', error: String(e?.message || e) };
    }
  }, url, options) as any;

  if (result.error) {
    throw new Error(`猎聘请求失败 (${url}): ${result.error}`);
  }
  if (!result.ok) {
    throw new Error(`猎聘 HTTP ${result.status} (${url}): ${result.text.slice(0, 200)}`);
  }
  if (result.text.trim().startsWith('<')) {
    throw new Error(`猎聘返回了 HTML (${url})，可能是登录态失效或反爬虫挑战`);
  }
  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`猎聘 JSON 解析失败 (${url}): ${result.text.slice(0, 200)}`);
  }
}

/** 推荐候选人列定义 */
export const RECOMMEND_COLUMNS = [
  { header: '姓名', key: 'name', width: 15 },
  { header: '职位', key: 'title', width: 25 },
  { header: '公司', key: 'company', width: 20 },
  { header: '薪资', key: 'salary', width: 15 },
  { header: '经验', key: 'experience', width: 10 },
  { header: '学历', key: 'education', width: 10 },
];

/** 人才列表列定义 */
export const TALENT_COLUMNS = [
  { header: '姓名', key: 'name', width: 15 },
  { header: '职位', key: 'title', width: 25 },
  { header: '公司', key: 'company', width: 20 },
  { header: '薪资', key: 'salary', width: 15 },
  { header: '经验', key: 'experience', width: 10 },
  { header: '学历', key: 'education', width: 10 },
  { header: '状态', key: 'status', width: 10 },
];
