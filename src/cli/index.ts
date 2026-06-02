#!/usr/bin/env node
/**
 * 猎聘 CLI 入口
 */

import { config } from '../config.js';
import { CdpBrowser } from '../browser/cdp_browser.js';
import { loginCommand } from '../toolset/login.js';
import { searchCommand } from '../toolset/search.js';
import { detailCommand } from '../toolset/detail.js';
import { companyCommand } from '../toolset/company.js';
import { chatlistCommand } from '../toolset/chatlist.js';
import { chatmsgCommand } from '../toolset/chatmsg.js';
import { recommendCommand } from '../toolset/recommend.js';
import { talentCommand } from '../toolset/talent.js';
import { resumeCommand } from '../toolset/resume.js';
import { greetCommand } from '../toolset/greet.js';
import { joblistCommand } from '../toolset/joblist.js';

/** 命令定义 */
interface Command {
  name: string;
  description: string;
  args: Array<{
    name: string;
    type: string;
    required?: boolean;
    positional?: boolean;
    default?: any;
    help: string;
  }>;
  columns: Array<{
    header: string;
    key: string;
    width: number;
  }>;
  func: (page: any, options: any) => Promise<any>;
}

/** 所有命令 */
const commands: Command[] = [
  loginCommand,
  searchCommand,
  detailCommand,
  companyCommand,
  chatlistCommand,
  chatmsgCommand,
  recommendCommand,
  talentCommand,
  resumeCommand,
  greetCommand,
  joblistCommand,
];

/** 显示帮助信息 */
function showHelp(): void {
  console.log(`
猎聘 CLI - 猎聘自动化命令行工具

用法:
  liepin <command> [options]

命令:
${commands.map(cmd => `  ${cmd.name.padEnd(15)} ${cmd.description}`).join('\n')}

选项:
  --help, -h      显示帮助信息
  --version, -v   显示版本信息

示例:
  liepin search 前端工程师
  liepin search 前端工程师 --city 北京 --experience 3-5年
  liepin detail 123456
  liepin company 789012
  liepin chatlist
  liepin recommend
  liepin greet 123456
`);
}

/** 显示版本信息 */
function showVersion(): void {
  console.log('liepin-cli v0.1.0');
}

/** 解析命令行参数 */
function parseArgs(args: string[]): { command: string; options: Record<string, any> } {
  let command = '';
  const options: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        options[key] = value;
        i++;
      } else {
        options[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else if (!options.positional) {
      options.positional = arg;
    }
  }

  return { command, options };
}

/** 格式化输出 */
function formatOutput(data: any, columns: Array<{ header: string; key: string; width: number }>): void {
  if (Array.isArray(data)) {
    // 表格输出
    const header = columns.map(col => col.header.padEnd(col.width)).join(' | ');
    console.log(header);
    console.log('-'.repeat(header.length));
    
    for (const item of data) {
      const row = columns.map(col => {
        const value = String(item[col.key] || '');
        return value.length > col.width ? value.slice(0, col.width - 3) + '...' : value.padEnd(col.width);
      }).join(' | ');
      console.log(row);
    }
  } else {
    // 详情输出
    for (const [key, value] of Object.entries(data)) {
      const column = columns.find(col => col.key === key);
      if (column) {
        console.log(`${column.header}: ${value}`);
      }
    }
  }
}

/** 主函数 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    return;
  }

  const { command, options } = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  if (options.version) {
    showVersion();
    return;
  }

  // 查找命令
  const cmd = commands.find(c => c.name === command);
  if (!cmd) {
    console.error(`错误: 未知命令 '${command}'`);
    console.error('使用 --help 查看可用命令');
    process.exit(1);
  }

  // 解析命令参数
  const cmdOptions: Record<string, any> = {};
  
  // 处理位置参数
  if (options.positional) {
    const requiredArg = cmd.args.find(a => a.required && a.positional);
    if (requiredArg) {
      cmdOptions[requiredArg.name] = options.positional;
    }
  }

  // 处理命名参数
  for (const arg of cmd.args) {
    if (options[arg.name] !== undefined) {
      cmdOptions[arg.name] = options[arg.name];
    } else if (arg.default !== undefined) {
      cmdOptions[arg.name] = arg.default;
    }
  }

  // 验证必需参数
  for (const arg of cmd.args) {
    if (arg.required && !cmdOptions[arg.name]) {
      console.error(`错误: 缺少必需参数 '${arg.name}'`);
      console.error(`使用 liepin ${command} --help 查看帮助`);
      process.exit(1);
    }
  }

  // 启动浏览器
  const browser = new CdpBrowser();
  let page;

  try {
    page = await browser.launch();
    
    // 执行命令
    const result = await cmd.func(page, cmdOptions);
    
    // 格式化输出
    formatOutput(result, cmd.columns);
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    // 关闭浏览器
    await browser.close();
  }
}

// 运行主函数
main().catch(error => {
  console.error('致命错误:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
