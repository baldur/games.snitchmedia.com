var LEFT = 37
var RIGHT = 39
var UP = 38
var DOWN = 40

onmessage = function (evt) {
    if(evt.data[0] === 'checkWall'){
        switch(evt.data[1]) {
        case LEFT:
          if(0 <= evt.data[3].left) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case RIGHT:
          if(evt.data[2].width > evt.data[3].left) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case UP:
          if(0 <= evt.data[3].top) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case DOWN:
          if(evt.data[2].height > evt.data[3].top) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        default:
          //code to be executed if n is different from case 1 and 2
        }
        postMessage(message);
    } else if(evt.data[0] === 'checkSnake') {
        var direction = evt.data[1];
        var currentPos = evt.data[2];
        var snake = evt.data[3];
        switch(direction) {
        case LEFT:
          currentPos.left -= 5;
          for(var i = 0; i<snake.x.length; i++) {
               if(currentPos.left === snake.x[i]) {
                   if(currentPos.top === snake.y[i]) {
                       postMessage(['snake', 'hit the snake']);
                   }
               }
           }
          break;
        case RIGHT:
          currentPos.left += 5;
          for(var i = 0; i<snake.x.length; i++) {
               if(currentPos.left === snake.x[i]) {
                   if(currentPos.top === snake.y[i]) {
                       postMessage(['snake', 'hit the snake']);
                   }
               }
           }
          break;
        case UP:
          currentPos.top -= 5;
          for(var i = 0; i<snake.y.length; i++) {
               if(currentPos.top === snake.y[i]) {
                   if(currentPos.left === snake.x[i]) {
                       postMessage(['snake', 'hit the snake']);
                   }
               }
           }
          break;
        case DOWN:
          currentPos.top += 5;
          for(var i = 0; i<snake.y.length; i++) {
               if(currentPos.top === snake.y[i]) {
                   if(currentPos.left === snake.x[i]) {
                       postMessage(['snake', 'hit the snake']);
                   }
               }
           }
          break;
        //
        default:
          //code to be executed if n is different from case 1 and 2
        }

          //check against snake
    } else {
        postMessage('dont know how to process this');
    }
};
