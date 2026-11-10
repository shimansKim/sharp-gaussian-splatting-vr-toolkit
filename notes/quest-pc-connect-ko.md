# PC 폴더 자동 연결 안내 (Quest 3 앱 ↔ PC)

PC의 `outputs` 폴더(또는 원하는 폴더)에 있는 PLY·영상·사진을 Quest 앱에서 IP 주소 입력 없이 바로 열어 보는 방법이다.

## 1. PC에서 할 일

1. 저장소 폴더의 `run_quest_pc_server.bat`를 더블클릭한다.
   - 기본으로 `outputs` 폴더를 보여 준다.
   - 다른 폴더를 보려면 그 폴더를 `run_quest_pc_server.bat` 파일 위로 끌어다 놓는다. 한 번 추가한 폴더는 `quest_server_folders.txt`에 기억된다.
2. 처음 실행하면 Windows 방화벽 창이 뜬다. **개인 네트워크**를 허용한다.
3. 검은 창에 "Quest 앱에서 [PC] 탭을 누르세요"가 보이면 준비가 끝났다. 창은 열어 둔다. 닫으면 연결이 끊긴다.

> 공유한 폴더는 같은 Wi-Fi(공유기)에 있는 모든 기기가 읽기 전용으로 볼 수 있다. 집처럼 믿을 수 있는 네트워크에서만 실행한다.

## 2. Quest에서 할 일

1. 앱을 열고 **[PC]** 탭을 누른다.
2. 처음에는 브라우저가 "로컬 네트워크 기기 찾기" 권한을 묻는다. **허용**을 누른다.
3. 연결되면 `PC 연결됨: <PC 이름>`이 보이고 최근 파일 목록이 나온다. 목록에서 고르면 열린다.
   폴더 이름을 누르면 안으로 들어간다.
4. 다음부터는 [PC] 탭을 열면 자동으로 연결한다.

앱은 먼저 마지막으로 성공한 주소로, 안 되면 `sharp-vr.local` 이름으로 PC를 찾는다. IP를 입력할 일은 없다.

## 3. 연결이 안 될 때

앱이 이유를 화면에 보여 주지만, 아래 순서로 확인하면 대부분 풀린다.

1. PC에서 `run_quest_pc_server.bat` 창이 열려 있는가.
2. Quest와 PC가 같은 Wi-Fi(같은 공유기)인가. 게스트 Wi-Fi나 "AP 격리"가 켜진 공유기는 기기끼리 보이지 않는다.
3. 방화벽에서 Python의 **개인 네트워크** 허용이 켜져 있는가.
   (설정 > 개인 정보 및 보안 > Windows 보안 > 방화벽 및 네트워크 보호 > 방화벽을 통해 앱 허용)
4. PC의 네트워크 프로필이 **개인**인가. (설정 > 네트워크 및 인터넷 > Wi-Fi 또는 이더넷 > 속성 > 네트워크 프로필 유형) "공용"이면 막힌다.
5. 로컬 네트워크 권한을 거부했다면 앱 주소창 왼쪽 자물쇠(사이트 설정)에서 허용으로 바꾼 뒤 [다시 연결]을 누른다.
6. 그래도 안 되면 [PC] 탭의 **고급: 주소 직접 입력**에 PC의 IP(예: `192.168.0.23`)를 적는다. 서버 창에 PC 주소가 출력된다. 이것은 비상용이다.

## 4. 개발자 메모

- 서버: `scripts/quest_media_server.py` (읽기 전용, Range 지원, `GET /api/info|list|recent`, `GET /files/<root>/<경로>`). 테스트: `python -m pytest tests/test_quest_media_server.py`.
- 앱: `quest-app/src/sources/pc-connect.js`(자동 연결), `pc-source.js`(Source 계약), `proxy-url.js`와 `public/sw/source-proxy.js`(서비스 워커 프록시), `src/ui/pc-panel.js`([PC] 탭 상태 표시). 테스트: `cd quest-app && npm test`.
- 서비스 워커 연결 방법은 `public/sw/source-proxy.js` 머리 주석에 있다.
- 실기기에서 LNA(로컬 네트워크 접근)·`sharp-vr.local`이 동작하는지는 `run_quest_pc_probe.bat`로 먼저 확인한다. 이 방식이 막히는 기기에서는 터널+페어링 코드 방식(설계 4.6)이 대안이다. 프로브 결과 전까지 구현하지 않았다.
