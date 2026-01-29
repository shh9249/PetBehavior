from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
import time
from datetime import datetime
import sys
import asyncio
from volcenginesdkarkruntime import AsyncArk

app = Flask(__name__)
CORS(app)

# 配置上传文件夹
UPLOAD_FOLDER = 'uploads'
ALLOWED_VIDEO_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm'}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# 初始化火山引擎客户端
ARK_API_KEY = os.getenv('ARK_API_KEY')
if not ARK_API_KEY:
    print("警告: 未设置 ARK_API_KEY 环境变量，将使用模拟响应")
    ARK_CLIENT = None
else:
    ARK_CLIENT = AsyncArk(
        base_url='https://ark.cn-beijing.volces.com/api/v3',
        api_key=ARK_API_KEY
    )

# 存储对话历史（简单实现，生产环境建议使用数据库）
conversation_history = {}


def allowed_file(filename):
    """检查文件扩展名是否允许"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_VIDEO_EXTENSIONS


async def call_text_api(user_message, session_id='default'):
    """调用文本对话API"""
    try:
        if not ARK_CLIENT:
            # 模拟响应（当API密钥未设置时）
            await asyncio.sleep(1)
            return f"[模拟响应] 我收到了你的消息：'{user_message}'。请设置 ARK_API_KEY 环境变量以使用真实API。"
        
        # 获取或初始化对话历史
        if session_id not in conversation_history:
            conversation_history[session_id] = []
        
        # 添加用户消息到历史
        conversation_history[session_id].append({
            "role": "user",
            "content": user_message
        })
        
        # 构建消息历史（保留最近10轮对话）
        messages = conversation_history[session_id][-20:]  # 最多10轮（用户+助手）
        
        # 调用API
        response = await ARK_CLIENT.chat.completions.create(
            model="doubao-seed-1-8-251228",
            messages=messages
        )
        
        # 提取回复
        assistant_message = response.choices[0].message.content
        
        # 添加助手回复到历史
        conversation_history[session_id].append({
            "role": "assistant",
            "content": assistant_message
        })
        
        return assistant_message
    
    except Exception as e:
        print(f"调用文本API时出错: {str(e)}")
        return f"抱歉，处理您的消息时出现错误：{str(e)}"


async def call_video_api(video_path, user_message=None, session_id='default'):
    """调用视频理解API，并支持对话历史"""
    try:
        if not ARK_CLIENT:
            # 模拟响应（当API密钥未设置时）
            await asyncio.sleep(2)
            mock_response = "这是一个模拟的视频分析结果。"
            if user_message:
                mock_response += f"\n\n用户提问：{user_message}"
            mock_response += "\n\n请设置 ARK_API_KEY 环境变量以使用真实的视频分析功能。"
            
            # 记录到对话历史
            _record_video_conversation(session_id, user_message, mock_response)
            
            return mock_response
        
        print(f"[{datetime.now()}] 开始上传视频文件...")
        
        # 上传视频文件
        file = await ARK_CLIENT.files.create(
            file=open(video_path, "rb"),
            purpose="user_data",
            preprocess_configs={
                "video": {
                    "fps": 0.3,  # 视频采样帧率
                }
            }
        )
        print(f"[{datetime.now()}] 视频上传成功: {file.id}")
        
        # 等待文件处理完成
        print(f"[{datetime.now()}] 等待视频处理...")
        await ARK_CLIENT.files.wait_for_processing(file.id)
        print(f"[{datetime.now()}] 视频处理完成: {file.id}")
        
        # 构建请求内容
        content = [
            {
                "type": "input_video",
                "file_id": file.id
            }
        ]
        
        # 如果有附加消息，添加到内容中
        if user_message:
            content.append({
                "type": "input_text",
                "text": user_message
            })
        else:
            # 默认提示词
            content.append({
                "type": "input_text",
                "text": "请详细分析这个视频中的宠物行为，包括动作、表情、情绪状态等，并给出专业的行为解读。"
            })
        
        # 获取对话历史（仅文本部分，用于上下文理解）
        history_messages = []
        if session_id in conversation_history:
            # 获取最近的对话历史（最多5轮，避免token过多）
            recent_history = conversation_history[session_id][-10:]
            history_messages = [{"role": msg["role"], "content": msg["content"]} 
                              for msg in recent_history]
        
        # 调用API分析视频（注意：这里可能需要根据实际API调整）
        print(f"[{datetime.now()}] 开始分析视频...")
        response = await ARK_CLIENT.responses.create(
            model="doubao-seed-1-8-251228",
            input=[
                {"role": "user", "content": content}
            ]
        )
        
        # 提取回复文本
        assistant_message = ""
        for output in response.output:
            if output.type == 'message' and output.role == 'assistant':
                for content_item in output.content:
                    if content_item.type == 'output_text':
                        assistant_message += content_item.text
        
        print(f"[{datetime.now()}] 视频分析完成")
        
        # 记录到对话历史
        _record_video_conversation(session_id, user_message, assistant_message)
        
        return assistant_message if assistant_message else "视频分析完成，但未获取到有效回复。"
    
    except Exception as e:
        print(f"调用视频API时出错: {str(e)}")
        import traceback
        traceback.print_exc()
        error_message = f"抱歉，分析视频时出现错误：{str(e)}"
        
        # 即使出错也记录到历史
        _record_video_conversation(session_id, user_message, error_message)
        
        return error_message


def _record_video_conversation(session_id, user_message, assistant_message):
    """将视频对话记录到历史中（仅保存文本，不保存视频文件）"""
    # 获取或初始化对话历史
    if session_id not in conversation_history:
        conversation_history[session_id] = []
    
    # 构建用户消息描述（包含视频标记和附加文本）
    user_content = "[上传了视频]"
    if user_message:
        user_content += f" {user_message}"
    else:
        user_content += " 请分析这个视频中的宠物行为。"
    
    # 添加用户消息到历史
    conversation_history[session_id].append({
        "role": "user",
        "content": user_content
    })
    
    # 添加助手回复到历史
    conversation_history[session_id].append({
        "role": "assistant",
        "content": assistant_message
    })
    
    print(f"[{datetime.now()}] 视频对话已记录到历史 (session: {session_id})")


@app.route('/api/chat', methods=['POST'])
def chat():
    """处理文本聊天消息"""
    try:
        data = request.json
        user_message = data.get('message', '')
        session_id = data.get('session_id', 'default')
        
        print(f"[{datetime.now()}] 收到文本消息: {user_message} (session: {session_id})")
        
        # 使用异步函数调用API
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        ai_response = loop.run_until_complete(call_text_api(user_message, session_id))
        loop.close()
        
        return jsonify({
            'success': True,
            'response': ai_response,
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        print(f"处理消息时出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/upload', methods=['POST'])
def upload_video():
    """处理视频上传和分析"""
    try:
        # 检查是否有文件
        if 'video' not in request.files:
            return jsonify({
                'success': False,
                'error': '没有找到视频文件'
            }), 400
        
        file = request.files['video']
        message = request.form.get('message', '')
        session_id = request.form.get('session_id', 'default')  # 获取session_id
        
        # 检查文件名
        if file.filename == '':
            return jsonify({
                'success': False,
                'error': '文件名为空'
            }), 400
        
        # 检查文件类型
        if not allowed_file(file.filename):
            return jsonify({
                'success': False,
                'error': f'不支持的文件格式。支持的格式: {", ".join(ALLOWED_VIDEO_EXTENSIONS)}'
            }), 400
        
        # 保存文件
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{timestamp}_{filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        
        file.save(filepath)
        file_size = os.path.getsize(filepath)
        
        print(f"[{datetime.now()}] 视频上传成功: {unique_filename} ({file_size} bytes)")
        if message:
            print(f"[{datetime.now()}] 附带消息: {message}")
        print(f"[{datetime.now()}] Session ID: {session_id}")
        
        # 调用视频分析API，传入session_id
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        ai_response = loop.run_until_complete(call_video_api(filepath, message, session_id))
        loop.close()
        
        return jsonify({
            'success': True,
            'response': ai_response,
            'filename': unique_filename,
            'filesize': file_size,
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        print(f"上传视频时出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/video/<filename>', methods=['GET'])
def serve_video(filename):
    """提供视频文件访问"""
    try:
        # 安全检查：确保文件名不包含路径遍历
        filename = secure_filename(filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # 检查文件是否存在
        if not os.path.exists(filepath):
            return jsonify({
                'success': False,
                'error': '视频文件不存在'
            }), 404
        
        # 返回视频文件
        return send_from_directory(
            app.config['UPLOAD_FOLDER'],
            filename,
            mimetype='video/mp4'
        )
    
    except Exception as e:
        print(f"获取视频时出错: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/health', methods=['GET'])
def health():
    """健康检查接口"""
    api_status = "configured" if ARK_API_KEY else "not_configured"
    return jsonify({
        'status': 'healthy',
        'service': 'PetBehavior Chat API',
        'timestamp': datetime.now().isoformat(),
        'python_version': sys.version,
        'api_status': api_status
    })


@app.route('/api/clear-history', methods=['POST'])
def clear_history():
    """清除对话历史"""
    try:
        data = request.json
        session_id = data.get('session_id', 'default')
        
        if session_id in conversation_history:
            conversation_history[session_id] = []
            print(f"[{datetime.now()}] 对话历史已清除 (session: {session_id})")
        
        return jsonify({
            'success': True,
            'message': '对话历史已清除'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/history', methods=['POST'])
def get_history():
    """获取对话历史（用于调试）"""
    try:
        data = request.json
        session_id = data.get('session_id', 'default')
        
        history = conversation_history.get(session_id, [])
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'history': history,
            'count': len(history)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


if __name__ == '__main__':
    print("=" * 50)
    print("PetBehavior Chat 后端服务启动")
    print("=" * 50)
    print(f"Python 版本: {sys.version}")
    print(f"上传文件夹: {os.path.abspath(UPLOAD_FOLDER)}")
    print(f"支持的视频格式: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}")
    print(f"最大文件大小: {MAX_FILE_SIZE / 1024 / 1024} MB")
    print(f"API 状态: {'已配置' if ARK_API_KEY else '未配置（使用模拟响应）'}")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=5000)

