# Plan: Tinh gọn nhóm Builtin agent

Phạm vi: 7 agent trong team `Builtin` (1 bot + 6 manager), cùng các skill, brief Tester/Reviewer và mô tả tool đi kèm.

Cách đánh dấu: `[ ]` chưa xong, `[x]` đã xong. Sửa trực tiếp file này khi làm xong từng mục.

## Tiến độ tổng

- [ ] Giai đoạn 0: Chốt baseline và ngân sách độ dài
- [ ] Giai đoạn 1: Gom phần lặp vào shared
- [ ] Giai đoạn 2: Tối ưu từng agent (1/7)
- [ ] Giai đoạn 3: Tối ưu skill và brief dùng chung
- [ ] Giai đoạn 4: Dọn code đăng ký agent
- [ ] Giai đoạn 5: Kiểm thử toàn bộ và đo kết quả

| Agent | File prompt | Ký tự baseline (đo thật) | Mục tiêu | Trạng thái |
| --- | --- | --- | --- | --- |
| Datatable Manager | `instructs/datatable-manager.ts` | 1635 | 1250 (thực tế 1591, tập trung vào cách điều phối thay vì độ dài) | [x] |
| Skill Manager | `instructs/skill-manager.ts` | 2784 | 2100 | [ ] |
| Site Manager | `instructs/site-manager.ts` | 3872 | 2800 | [ ] |
| Job Manager | `instructs/job-manager.ts` | 4316 | 3100 | [ ] |
| Tool Manager | `instructs/tool-manager.ts` | 4266 | 3100 | [ ] |
| Agent Manager | `instructs/agent-manager.ts` | 5394 (đã gồm reviewer brief) | 3500 | [ ] |
| Nonla Bot | `instructs/nonla-bot.ts` | 2956 | 2200 | [ ] |

Tổng 7 agent: 25223 ký tự. Mục tiêu: khoảng 18050 (giảm trên 28%).

Skill (baseline): `write_agent_instruct` 949, `datatable_schema` 2361 (đã xóa), `sdk` 2958, `code_rules` 514 (+ 3 reference: 1377, 652, 786), `tester_brief` 689 (+ 4 reference: 886, 617, 800, 686).

Thư mục gốc: `src/server/src/modules/nonla-bot/`.

---

## Giai đoạn 0: Baseline

Mục tiêu: có số liệu trước khi sửa, để biết sửa xong có tốt hơn không.

- [ ] Viết một test đo độ dài `instruct()` của từng agent và từng skill (đặt trong `src/server/src/__tests__/nonla-bot.test.ts`). Script đo ngoài test chạy khoảng 40 giây vì import kéo theo cả server, nên nên đo trong test.
- [x] Ghi lại số ký tự baseline vào bảng ở trên.
- [ ] Chạy `bun test src/server/src/__tests__/nonla-bot.test.ts` và ghi nhận test nào đang pass, để biết cái gì không được vỡ.
- [ ] Soạn bộ kịch bản kiểm tra tay, mỗi agent 2 đến 3 yêu cầu thật (xem phần Kịch bản ở cuối).
- [ ] Chạy kịch bản trên bản hiện tại, lưu lại kết quả để so sánh.

## Giai đoạn 1: Gom phần lặp vào shared

Các đoạn sau đang lặp gần nguyên văn ở nhiều manager. Gom lại trong `instructs/shared.ts` rồi chèn vào bằng hàm.

- [ ] "List trước khi update/delete, dùng id thật, không tự bịa id" (có ở cả 6 manager và bot).
- [ ] "Hỏi trước khi xóa, trừ khi caller đã nói rõ" (có ở cả 6 manager và bot).
- [ ] Mục `# Reply` (trả lời theo ngôn ngữ user, ngắn, nêu id và thay đổi). Mỗi agent chỉ khác một câu cuối.
- [ ] Mục `# When to stop` (dừng khi xong, hoặc hỏi đúng một câu rồi dừng).
- [ ] Mục `# When a call goes wrong` (lỗi tool không tính là fail test, thử lại một lần rồi báo lỗi; không gọi Tester/Reviewer lần hai; verdict không phải JSON thì tính "No verdict").
- [ ] Đoạn "nếu task có link thì `nonla_web_fetch`; cần tên bảng thì `nonla_datatable` chỉ với `list_projects` hoặc `get_schema`; không bịa tên" (lặp ở tool, site, job).
- [ ] Vòng lặp "get code, edit, chạy, sửa, gọi Tester" (gần như giống hệt ở tool, site, job). Viết một hàm sinh vòng lặp, truyền vào tên tool đọc, sửa, kiểm tra.
- [ ] Thống nhất giới hạn số vòng sửa: job đang giới hạn 5 vòng, tool đang "không giới hạn". Chọn một quy tắc chung (đề xuất: 5 vòng, hoặc dừng khi cùng một lỗi lặp lại hai lần).
- [ ] Chạy test, đảm bảo prompt sau khi gom có nội dung tương đương bản cũ.

## Giai đoạn 2: Tối ưu từng agent

Mỗi agent đều làm theo cùng một danh sách. Mục "Việc riêng" là phát hiện cụ thể cho agent đó.

Danh sách chung cho mỗi agent:

1. Đọc prompt hiện tại và liệt kê mọi tool, skill agent đó có.
2. Xóa câu mà model vốn đã biết. Giữ lại quy tắc đặc thù, bước dễ sai, định dạng đầu ra.
3. Mỗi quy tắc phải tương ứng một hành vi kiểm tra được. Quy tắc nào không đổi hành vi thì bỏ.
4. Rút gọn mô tả tool (`description`, `summary`) của agent đó.
5. Rà `uses`: tool nào không được nhắc trong prompt và không cần thì bỏ.
6. Chạy test, rồi chạy kịch bản tay, so với baseline.
7. Đo ký tự, ghi vào bảng.

### 2.1 Datatable Manager (làm đầu tiên, nhỏ nhất, dùng để thử quy trình)

File: `instructs/datatable-manager.ts`, `managers/datatable-manager.ts`.

Việc riêng:
- [x] `uses` đang có `nonla_web_fetch`, `nonla_run_js`, `nonla_get_current_time` nhưng prompt không hề nhắc tới. Quyết định giữ hay bỏ.
- [x] Gộp 4 dòng liệt kê tool (projects, tables, schema, records) thành một bảng ngắn hoặc bỏ bớt vì mô tả tool đã nói rõ.
- [x] Quy tắc "tạo bảng có cột: `create_table` trước, rồi một `edit_schema`" đã có trong mô tả tool `nonla_manage_datatable_schema`. Chỉ giữ ở một nơi.

Checklist:
- [x] Audit prompt và tool
- [x] Rút gọn prompt
- [x] Rút gọn mô tả tool
- [x] Rà `uses`
- [x] Test pass
- [ ] Kịch bản tay đạt
- [x] Ghi số ký tự mới

### 2.2 Skill Manager

File: `instructs/skill-manager.ts`, `managers/skill-manager.ts`.

Việc riêng:
- [ ] Prompt trả lời cho cùng một tình huống ở hai chỗ: "Reviewer nói không có thay đổi" và "3 lần review fail". Gộp thành một khối quy tắc kết thúc.
- [ ] Làm rõ ranh giới với `nonla_skill_draft_writer`: manager không viết file, chỉ truyền task. Bỏ các câu nhắc lại điều này.
- [ ] Kiểm tra mô tả `nonla_skill_draft_writer` và `nonla_approve_skill` có trùng với prompt không.

Checklist:
- [ ] Audit prompt và tool
- [ ] Rút gọn prompt
- [ ] Rút gọn mô tả tool
- [ ] Rà `uses`
- [ ] Test pass
- [ ] Kịch bản tay đạt
- [ ] Ghi số ký tự mới

### 2.3 Site Manager

File: `instructs/site-manager.ts`, `managers/site-manager.ts`.

Việc riêng:
- [ ] Dùng vòng lặp chung từ giai đoạn 1 thay cho đoạn "Changing the site files".
- [ ] Gộp hai quy tắc đọc skill (`code-rules` reference `site`, và `nonla-sdk`) thành một đoạn.
- [ ] Làm rõ ba file `app.tsx`, `styles.css`, `backend.ts` ở một chỗ duy nhất.
- [ ] Quy tắc `isPublished` chỉ giữ một câu.

Checklist:
- [ ] Audit prompt và tool
- [ ] Rút gọn prompt
- [ ] Rút gọn mô tả tool
- [ ] Rà `uses`
- [ ] Test pass
- [ ] Kịch bản tay đạt
- [ ] Ghi số ký tự mới

### 2.4 Job Manager

File: `instructs/job-manager.ts`, `managers/job-manager.ts`.

Việc riêng:
- [ ] Dùng vòng lặp chung. Giữ riêng hai điểm đặc thù của job: `status running` nghĩa là timeout, và job có thể có side effect thật.
- [ ] Gộp quy tắc cron: chỉ đặt khi caller yêu cầu và sau khi chạy sạch; muốn tạm dừng thì đặt chuỗi rỗng.
- [ ] Mục "Changing the job record" chỉ có một câu, đưa vào Ground rules.
- [ ] Brief của Tester (`jobTesterBrief`) và quy tắc "không chạy khi job gửi hoặc xóa dữ liệu" phải khớp với prompt manager.

Checklist:
- [ ] Audit prompt và tool
- [ ] Rút gọn prompt
- [ ] Rút gọn mô tả tool
- [ ] Rà `uses`
- [ ] Test pass
- [ ] Kịch bản tay đạt
- [ ] Ghi số ký tự mới

### 2.5 Tool Manager

File: `instructs/tool-manager.ts`, `managers/tool-manager.ts`.

Việc riêng:
- [ ] Dùng vòng lặp chung. Bỏ "không giới hạn vòng" cho khớp quy tắc đã thống nhất.
- [ ] Giữ riêng phần `testInput` phải khớp các dòng `@param`.
- [ ] Giữ riêng `nonla_search_npm`, kiểm tra mô tả tool này đã đủ để prompt không phải nhắc.
- [ ] Khối "Already tested / Not tested yet" gửi cho Tester: giữ vì đây là logic đặc thù, nhưng viết ngắn lại.
- [ ] Thêm tới site và job nếu thấy hữu ích (hiện chỉ tool có khối này). Nếu không thì để nguyên.

Checklist:
- [ ] Audit prompt và tool
- [ ] Rút gọn prompt
- [ ] Rút gọn mô tả tool
- [ ] Rà `uses`
- [ ] Test pass
- [ ] Kịch bản tay đạt
- [ ] Ghi số ký tự mới

### 2.6 Agent Manager

File: `instructs/agent-manager.ts`, `managers/agent-manager.ts` (362 dòng, file lớn nhất).

Việc riêng:
- [ ] Reviewer brief đang dán thẳng vào prompt (`mdFence("markdown", agentReviewerBrief())`) mỗi lần chạy. Các manager khác thì để brief trong skill `tester-brief`. Chuyển brief này thành reference `agent` của skill `tester-brief` để thống nhất và giảm prompt.
- [ ] Ground rules đang là một khối dài trộn nhiều chuyện (model, builtin read-only, tool core, datatable, KV). Chia theo chủ đề: Bảo vệ builtin, Chọn model, Tool và skill được gán.
- [ ] Danh sách tool core ("Every agent already has nonla_read_skill, nonla_background_tasks, ...") xuất hiện hai lần (Ground rules và khối Reviewer). Lấy từ một hằng số dùng chung.
- [ ] Quy trình đổi system prompt có 6 bước. Rút gọn còn các bước thật sự cần.
- [ ] Rà `managers/agent-manager.ts`: hàm `listToolOptions`, `assertToolIdsExist`, `modelFields` có thể tách file nhỏ hơn. Chỉ làm nếu không đổi hành vi.

Checklist:
- [ ] Audit prompt và tool
- [ ] Chuyển Reviewer brief sang skill `tester-brief`
- [ ] Rút gọn prompt
- [ ] Rút gọn mô tả tool
- [ ] Rà `uses`
- [ ] Test pass
- [ ] Kịch bản tay đạt
- [ ] Ghi số ký tự mới

### 2.7 Nonla Bot (làm cuối, vì phụ thuộc mô tả của 6 manager)

File: `instructs/nonla-bot.ts`, `builtin-agents.ts`.

Việc riêng:
- [ ] `description` của bot ghi "Handles KV entries and secrets itself" nhưng prompt còn làm cả MCP servers. Sửa cho khớp.
- [ ] Danh sách 6 manager trong prompt lặp lại thông tin có sẵn trong `description` của từng manager (bot đã thấy qua tool `nonla_call_agent__*`). Rút thành một dòng mỗi manager hoặc bỏ phần mô tả.
- [ ] Gộp ba nhóm "tự làm" (KV, secrets, MCP) thành một đoạn.
- [ ] Quy tắc mở trang: giữ ngắn, chỉ nêu điều kiện gọi `nonla_goto_page`.
- [ ] Quy tắc "agent cần đọc ghi bảng thì nhờ Agent Manager gắn Datatable Manager": kiểm tra lại có cần ở bot hay đã nằm đủ trong Agent Manager.
- [ ] Bỏ các quy tắc đã có trong shared (list trước khi sửa, hỏi trước khi xóa) nếu giai đoạn 1 đã đủ.

Checklist:
- [ ] Audit prompt và tool
- [ ] Rút gọn prompt
- [ ] Sửa `description` cho khớp
- [ ] Rà `uses` và tool đang gán
- [ ] Test pass
- [ ] Kịch bản tay đạt
- [ ] Ghi số ký tự mới

## Giai đoạn 3: Skill và brief dùng chung

File: `builtin-skills.ts`, `builtin-skill-docs.ts` (8.5k ký tự), `instructs/tester-brief.ts`.

- [ ] `Write Agent System Prompt`: kiểm tra có mâu thuẫn với prompt đã rút gọn của Agent Manager không.
- [x] `datatable-schema`: đã bỏ skill, quy tắc thiết kế cột chuyển vào mô tả tool `nonla_manage_datatable_schema`.
- [ ] `nonla-sdk`: rà, đảm bảo ví dụ ngắn nhất có thể.
- [ ] `code-rules` (3 reference: tool, site, job): tìm phần lặp giữa 3 reference, đưa phần chung lên nội dung chính.
- [ ] `tester-brief` (4 reference, sắp thêm `agent`): kiểm tra các brief đủ ngắn.
- [ ] `testerBrief()` đang dùng regex bọc backtick quanh mọi chuỗi `nonla_*`. Cân nhắc viết sẵn backtick trong nguồn để bỏ regex này.
- [ ] Cập nhật `agentIds` của từng skill nếu agent nào không còn dùng.

## Giai đoạn 4: Dọn code đăng ký agent

- [ ] `builtin-ids.ts`: `isBuiltinAgentId` và `isCoreManagerAgentId` chồng nhau về ý nghĩa. Xem có cần giữ cả hai không.
- [ ] `managers/*.ts`: `uses` ghi label trùng id (ví dụ `nonla_web_fetch` có label `nonla_web_fetch`). Dùng label đọc được hoặc lấy từ `NONLA_BUILTIN_TOOLS`.
- [ ] `managers/index.ts`: ba danh sách `*_DELEGATED_TOOLS`, `NONLA_SPECIALISTS`, `NONLA_BOT_DELEGATED_TOOLS` có thể suy ra từ một nguồn.
- [ ] `sync-builtin-agents.ts` (315 dòng): kiểm tra phần đồng bộ có còn chỗ thừa sau khi gom.

## Giai đoạn 5: Kiểm thử toàn bộ

- [ ] `bun test src/server/src/__tests__/nonla-bot.test.ts` pass
- [ ] `bun run test` pass toàn bộ
- [ ] `bun run typecheck:server` pass
- [ ] `bun run lint` pass
- [ ] Chạy lại bộ kịch bản tay, so với baseline
- [ ] Cập nhật bảng ký tự cuối cùng ở đầu file
- [ ] Tổng ký tự giảm ít nhất 25% so với baseline

## Kịch bản kiểm tra tay

Chạy qua Nonla Bot ở môi trường dev. Mỗi kịch bản phải cho kết quả giống hoặc tốt hơn baseline.

| Agent | Kịch bản |
| --- | --- |
| Datatable Manager | Tạo project, tạo bảng 3 cột, thêm 5 dòng, rồi xóa 1 dòng. |
| Skill Manager | Tạo skill từ một mô tả ngắn, qua review, được approve. |
| Site Manager | Tạo site một trang gọi `backend.ts` đọc một bảng, `nonla_check_site` ok. |
| Job Manager | Tạo job chạy mỗi giờ, đặt cron sau khi chạy sạch. Job có gửi dữ liệu thì không tự chạy. |
| Tool Manager | Tạo tool nhận 2 tham số, chạy thử, qua Tester. |
| Agent Manager | Tạo agent mới có model, gắn tool, viết system prompt, qua Reviewer. |
| Nonla Bot | Một yêu cầu cần hai manager nối nhau (ví dụ tạo agent rồi gắn Datatable Manager). Một yêu cầu về secret. |

## Nguyên tắc khi sửa

- Không viết comment trong file code.
- Không làm mất quy tắc an toàn: builtin read-only, hỏi trước khi xóa, không bịa id.
- Mỗi lần chỉ sửa một agent, chạy test rồi mới sang agent tiếp.
- Commit theo Conventional Commits, mỗi agent một commit (`refactor(nonla-bot): trim datatable manager prompt`).
