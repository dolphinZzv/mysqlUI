import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "en" | "zh";

const STORAGE_KEY = "mysqlui.lang";

// Only the Chinese strings need to be maintained here. English text is passed
// inline as the fallback to t(), so a missing key simply renders English.
const zh: Record<string, string> = {
  // app shell
  "app.name": "MySQL UI",
  "app.subtitle": "数据库管理工具",
  "app.newQuery": "新建查询",
  "app.newConnection": "新建连接",
  "app.toggleTheme": "切换主题",
  "app.toggleSidebar": "显示/隐藏侧栏",
  "app.language": "语言",
  "app.logout": "退出登录",
  "app.search": "全局搜索",
  "app.monitor": "服务器监控",
  "app.users": "用户与权限",
  "app.erd": "关系图",
  "app.diff": "结构对比",
  "app.queryBuilder": "查询构建器",
  "app.import": "导入数据",
  "app.backup": "备份",
  "app.favorites": "收藏",
  "app.connections": "连接",

  // sidebar
  "sidebar.connections": "连接",
  "sidebar.refreshAll": "全部刷新",
  "sidebar.newConnection": "新建连接",
  "sidebar.filter": "筛选连接",
  "sidebar.noConnections": "还没有连接",
  "sidebar.addConnection": "添加连接",
  "sidebar.noDatabases": "无数据库",
  "sidebar.noTables": "无表",
  "sidebar.newQuery": "新建查询",
  "sidebar.newTable": "新建表",
  "sidebar.refresh": "刷新",
  "sidebar.refreshTables": "刷新表",
  "sidebar.test": "测试连接",
  "sidebar.edit": "编辑",
  "sidebar.delete": "删除",
  "sidebar.exportSql": "导出 SQL",
  "sidebar.copyName": "复制名称",
  "sidebar.copySelect": "复制 SELECT",
  "sidebar.openTable": "打开表",
  "sidebar.importCsv": "导入 CSV",
  "sidebar.routines": "存储过程/函数",
  "sidebar.triggers": "触发器",
  "sidebar.events": "事件",
  "sidebar.views": "视图",
  "sidebar.erd": "关系图",
  "sidebar.diff": "结构对比",
  "sidebar.monitor": "监控",
  "sidebar.users": "用户",
  "sidebar.connectionCount": "个连接",
  "sidebar.deleteConnectionTitle": "删除连接？",
  "sidebar.deleteConnectionDesc": "将从本工具移除",

  // tabs
  "tab.data": "数据",
  "tab.structure": "结构",
  "tab.query": "查询",
  "tab.monitor": "监控",
  "tab.users": "用户",
  "tab.erd": "关系图",
  "tab.diff": "结构对比",
  "tab.routines": "存储过程",

  // toolbar / table
  "table.insertRow": "插入行",
  "table.refresh": "刷新",
  "table.filter": "筛选",
  "table.export": "导出",
  "table.page": "/ 页",
  "table.perPage": "行/页",
  "table.of": "共",
  "table.noRows": "没有数据",
  "table.loading": "加载中…",
  "table.deleteRowTitle": "删除此行？",
  "table.deleteRowDesc": "将从表中永久删除该行，此操作不可撤销。",
  "table.delete": "删除",
  "table.cancel": "取消",
  "table.insert": "插入",
  "table.updated": "已更新",
  "table.deleted": "已删除行",
  "table.inserted": "已插入行",
  "table.noPk": "该表没有主键，无法安全定位行",
  "table.editCell": "编辑单元格",
  "table.viewCell": "查看内容",
  "table.setNull": "设为 NULL",
  "table.copyValue": "复制值",
  "table.foreignKey": "跳转到关联行",

  // structure
  "structure.columns": "字段",
  "structure.indexes": "索引",
  "structure.createSql": "建表语句",
  "structure.addColumn": "添加字段",
  "structure.addIndex": "添加索引",
  "structure.rename": "重命名",
  "structure.drop": "删除表",
  "structure.copy": "复制",
  "structure.copied": "已复制",
  "structure.noIndexes": "没有索引",
  "structure.actions": "操作",
  "structure.name": "名称",
  "structure.type": "类型",
  "structure.nullable": "可空",
  "structure.key": "键",
  "structure.default": "默认值",
  "structure.extra": "额外",
  "structure.comment": "注释",
  "structure.unique": "唯一",
  "structure.cardinality": "基数",
  "structure.dropTableTitle": "删除表",
  "structure.dropTableDesc": "将永久删除该表及其所有数据。",

  // query
  "query.run": "运行",
  "query.clear": "清空",
  "query.history": "历史",
  "query.recentQueries": "最近查询",
  "query.clearHistory": "清空历史",
  "query.connection": "连接",
  "query.database": "数据库",
  "query.noDatabase": "（无数据库）",
  "query.placeholder": "SELECT * FROM users LIMIT 100;",
  "query.runHint": "运行查询以查看结果",
  "query.error": "错误",
  "query.rowsReturned": "行返回",
  "query.truncated": "已截断",
  "query.autocomplete": "自动补全 (Ctrl+Space)",
  "query.format": "格式化",
  "query.builder": "构建查询",
  "query.copy": "复制",
  "query.exportCsv": "导出 CSV",
  "query.exportJson": "导出 JSON",
  "query.copyInsert": "复制为 INSERT",
  "query.copyCsv": "复制为 CSV",

  // connection dialog
  "conn.new": "新建连接",
  "conn.edit": "编辑连接",
  "conn.desc": "配置 MySQL / MariaDB 服务器，凭据保存在后端本地。",
  "conn.name": "连接名称",
  "conn.host": "主机",
  "conn.port": "端口",
  "conn.user": "用户",
  "conn.password": "密码",
  "conn.database": "默认数据库（可选）",
  "conn.ssl": "SSL",
  "conn.ssh": "通过 SSH 隧道连接",
  "conn.sshHost": "SSH 主机",
  "conn.sshPort": "SSH 端口",
  "conn.sshUser": "SSH 用户",
  "conn.sshAuth": "认证方式",
  "conn.sshPassword": "SSH 密码",
  "conn.sshKey": "私钥 (PEM)",
  "conn.sshPassphrase": "私钥口令（可选）",
  "conn.sshIgnoreHostKey": "忽略主机密钥校验（跳过 known_hosts）",
  "conn.test": "测试连接",
  "conn.cancel": "取消",
  "conn.save": "保存",
  "conn.create": "创建",
  "conn.testOk": "连接成功",
  "conn.testFail": "连接失败",
  "conn.saved": "已保存",
  "conn.created": "已创建",
  "conn.required": "名称、主机和用户为必填项",

  // login
  "login.title": "登录 MySQL UI",
  "login.desc": "请输入访问密码。",
  "login.password": "密码",
  "login.submit": "登录",
  "login.error": "密码错误",
  "login.loggingIn": "登录中…",

  // monitor
  "monitor.overview": "概览",
  "monitor.processes": "进程列表",
  "monitor.status": "状态变量",
  "monitor.variables": "系统变量",
  "monitor.kill": "终止",
  "monitor.killQuery": "终止查询",
  "monitor.killConfirm": "终止该连接？",
  "monitor.killed": "已终止进程",
  "monitor.filter": "筛选变量",
  "monitor.id": "ID",
  "monitor.user": "用户",
  "monitor.db": "数据库",
  "monitor.command": "命令",
  "monitor.time": "时长",
  "monitor.state": "状态",
  "monitor.info": "SQL",
  "monitor.uptime": "运行时间",
  "monitor.qps": "QPS",
  "monitor.threads": "连接/运行线程",
  "monitor.questions": "总查询",
  "monitor.slow": "慢查询",
  "monitor.bytes": "收发字节",
  "monitor.refresh": "刷新",

  // import / backup
  "import.title": "导入数据",
  "import.csv": "导入 CSV 到表",
  "import.sql": "导入 / 恢复 SQL",
  "import.file": "选择文件",
  "import.hasHeader": "首行为列名",
  "import.truncate": "导入前清空表",
  "import.nullValue": "空值标记（映射为 NULL）",
  "import.delimiter": "分隔符",
  "import.submit": "开始导入",
  "import.importing": "导入中…",
  "import.done": "导入完成",
  "import.statements": "条语句已执行",
  "import.rows": "行已导入",
  "import.backupServer": "备份整个服务器 (SQL)",
  "import.backupDb": "备份该数据库 (SQL)",

  // users
  "users.title": "用户",
  "users.user": "用户",
  "users.host": "主机",
  "users.plugin": "认证插件",
  "users.grants": "权限",
  "users.create": "新建用户",
  "users.newPassword": "密码",
  "users.drop": "删除用户",
  "users.grant": "授权",
  "users.revoke": "撤销",
  "users.privileges": "权限列表",
  "users.database": "数据库",
  "users.table": "表",
  "users.withGrant": "允许转授权",
  "users.grantsFor": "权限明细",

  // search
  "search.placeholder": "搜索表名或列名…",
  "search.tables": "表",
  "search.columns": "列",
  "search.noResults": "无结果",
  "search.hint": "输入以搜索所有数据库",

  // erd
  "erd.title": "关系图",
  "erd.empty": "该数据库没有外键关系",
  "erd.tables": "张表",
  "erd.relations": "个关系",
  "erd.zoomIn": "放大",
  "erd.zoomOut": "缩小",
  "erd.reset": "重置",

  // diff
  "diff.title": "结构对比",
  "diff.source": "源（参照）",
  "diff.target": "目标（将被修改）",
  "diff.compare": "开始对比",
  "diff.columnsAdded": "新增字段",
  "diff.columnsRemoved": "删除字段",
  "diff.columnsChanged": "修改字段",
  "diff.indexesAdded": "新增索引",
  "diff.indexesRemoved": "删除索引",
  "diff.ddl": "生成 SQL",
  "diff.copyDdl": "复制 SQL",
  "diff.execute": "执行 SQL",
  "diff.noDiff": "结构一致，无差异",
  "diff.executed": "已执行",

  // query builder
  "qb.title": "查询构建器",
  "qb.table": "表",
  "qb.columns": "选择字段（不选=*）",
  "qb.where": "条件",
  "qb.orderBy": "排序",
  "qb.limit": "限制行数",
  "qb.generate": "生成 SQL",
  "qb.apply": "填入编辑器",
  "qb.addCondition": "添加条件",

  // common
  "common.close": "关闭",
  "common.cancel": "取消",
  "common.save": "保存",
  "common.ok": "确定",
  "common.delete": "删除",
  "common.add": "添加",
  "common.remove": "移除",
  "common.apply": "应用",
  "common.loading": "加载中…",
  "common.error": "出错了",
  "common.empty": "暂无内容",
  "common.search": "搜索",
  "common.yes": "是",
  "common.no": "否",
  "common.none": "无",
};

const dictionaries: Record<Lang, Record<string, string>> = { en: {}, zh };

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);

  const t = useCallback(
    (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      let text = dictionaries[lang][key] ?? fallback ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return text;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
